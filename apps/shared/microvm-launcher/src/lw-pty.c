/*
 * lw-pty: workload and exec helper of the generic microVM guest (guest tools, `/tools/bin/lw-pty`).
 *
 * Built static (`musl-gcc -static`) in the launcher image, so it runs from the read-only guest tools regardless of the
 * guest image's libc. The guest bridge agent runs as root outside the image root and starts every process of the
 * image through it:
 *
 *   lw-pty --new-ns --pid-file <f> --root <dir> --uid <n> --gid <n> --groups <a,b> --cwd <dir> -- <argv...>
 *       the workload: new mount + PID namespace (the workload is PID 1 of its namespace, `/proc` shows only its
 *       processes), chroot into the image root, ids, working directory, exec. The PID of the namespace init (as seen
 *       by the agent) is written to <f> for exec sessions.
 *   lw-pty --join-pid-file <f> [--pty] --root <dir> --uid <n> --gid <n> --groups <a,b> --cwd <dir> -- <argv...>
 *       an exec session: joins the workload's mount and PID namespaces, then as above. With --pty the command runs on
 *       a fresh pseudo terminal of the workload's devpts and the helper relays it to stdin / stdout; file descriptor 3
 *       carries control lines from the agent ("resize <cols> <rows>", "signal <number>"), the protocol of
 *       pty-helper.py (bundled mode). AGENSTRA_PTY_COLS / AGENSTRA_PTY_ROWS give the initial size.
 *
 * The parent forwards termination signals to the command and exits with its status (128 + signal for signal deaths),
 * like `docker exec` / a container's init. The command dies with the helper (PR_SET_PDEATHSIG). A command that can't
 * be started exits 127 (not found) or 126.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#ifndef TIOCGPTPEER
#define TIOCGPTPEER _IO('T', 0x41)
#endif

#define CONTROL_FD 3
#define MAX_GROUPS 64
#define EXIT_HELPER_FAILED 125

static pid_t child_pid = -1;
static int pty_master = -1;

struct options {
  int new_ns;
  int pty;
  const char *pid_file;
  const char *join_pid_file;
  const char *root;
  const char *cwd;
  uid_t uid;
  gid_t gid;
  gid_t groups[MAX_GROUPS];
  size_t group_count;
  char **argv;
};

static void fail(const char *what) {
  fprintf(stderr, "lw-pty: %s: %s\n", what, strerror(errno));
  _exit(EXIT_HELPER_FAILED);
}

static void usage(const char *message) {
  fprintf(stderr, "lw-pty: %s\n", message);
  _exit(EXIT_HELPER_FAILED);
}

static unsigned long parse_number(const char *value, unsigned long max, const char *what) {
  char *end = NULL;
  unsigned long number;

  errno = 0;
  number = strtoul(value, &end, 10);

  if (errno || !end || *end || end == value || number > max) {
    usage(what);
  }

  return number;
}

static void parse_groups(struct options *options, const char *value) {
  char buffer[1024];
  char *token, *save = NULL;

  if (strlen(value) >= sizeof(buffer)) {
    usage("--groups too long");
  }

  strcpy(buffer, value);

  for (token = strtok_r(buffer, ",", &save); token; token = strtok_r(NULL, ",", &save)) {
    if (options->group_count == MAX_GROUPS) {
      usage("too many groups");
    }

    options->groups[options->group_count++] = (gid_t)parse_number(token, UINT_MAX - 1, "invalid group");
  }
}

static void parse(struct options *options, int argc, char **argv) {
  int index;

  memset(options, 0, sizeof(*options));
  options->cwd = "/";

  for (index = 1; index < argc; index++) {
    const char *arg = argv[index];
    const char *value = index + 1 < argc ? argv[index + 1] : NULL;

    if (!strcmp(arg, "--")) {
      options->argv = &argv[index + 1];
      break;
    } else if (!strcmp(arg, "--new-ns")) {
      options->new_ns = 1;
    } else if (!strcmp(arg, "--pty")) {
      options->pty = 1;
    } else if (!value) {
      usage("missing option value");
    } else if (!strcmp(arg, "--pid-file")) {
      options->pid_file = value;
      index++;
    } else if (!strcmp(arg, "--join-pid-file")) {
      options->join_pid_file = value;
      index++;
    } else if (!strcmp(arg, "--root")) {
      options->root = value;
      index++;
    } else if (!strcmp(arg, "--cwd")) {
      options->cwd = value;
      index++;
    } else if (!strcmp(arg, "--uid")) {
      options->uid = (uid_t)parse_number(value, UINT_MAX - 1, "invalid uid");
      index++;
    } else if (!strcmp(arg, "--gid")) {
      options->gid = (gid_t)parse_number(value, UINT_MAX - 1, "invalid gid");
      index++;
    } else if (!strcmp(arg, "--groups")) {
      parse_groups(options, value);
      index++;
    } else {
      usage("unknown option");
    }
  }

  if (!options->argv || !options->argv[0]) {
    usage("missing command");
  }

  if (!options->root || options->root[0] != '/') {
    usage("--root <absolute dir> is required");
  }

  if (options->cwd[0] != '/') {
    usage("--cwd must be absolute");
  }

  if (options->new_ns && options->join_pid_file) {
    usage("--new-ns and --join-pid-file are exclusive");
  }
}

static unsigned short dimension(const char *value, unsigned short fallback) {
  long number;

  if (!value || !*value) {
    return fallback;
  }

  number = strtol(value, NULL, 10);

  if (number < 1) {
    return 1;
  }

  return number > 1000 ? 1000 : (unsigned short)number;
}

static void set_size(int fd, unsigned short cols, unsigned short rows) {
  struct winsize size;

  memset(&size, 0, sizeof(size));
  size.ws_col = cols;
  size.ws_row = rows;
  ioctl(fd, TIOCSWINSZ, &size);
}

/* Joins the mount and PID namespaces of the workload (the PID file holds its namespace init). */
static void join_namespaces(const char *pid_file) {
  char buffer[32], path[64];
  ssize_t length;
  int fd, pid_ns, mnt_ns;
  long pid;

  fd = open(pid_file, O_RDONLY | O_CLOEXEC);

  if (fd < 0) {
    fail("the workload is not running");
  }

  length = read(fd, buffer, sizeof(buffer) - 1);
  close(fd);

  if (length <= 0) {
    usage("the workload is not running");
  }

  buffer[length] = 0;
  pid = strtol(buffer, NULL, 10);

  if (pid < 2) {
    usage("invalid workload pid");
  }

  snprintf(path, sizeof(path), "/proc/%ld/ns/pid", pid);
  pid_ns = open(path, O_RDONLY | O_CLOEXEC);
  snprintf(path, sizeof(path), "/proc/%ld/ns/mnt", pid);
  mnt_ns = open(path, O_RDONLY | O_CLOEXEC);

  if (pid_ns < 0 || mnt_ns < 0) {
    fail("the workload is not running");
  }

  if (setns(pid_ns, CLONE_NEWPID) < 0) {
    fail("setns pid");
  }

  if (setns(mnt_ns, CLONE_NEWNS) < 0) {
    fail("setns mnt");
  }

  close(pid_ns);
  close(mnt_ns);
}

/* A pseudo terminal of the image root's devpts (`<root>/dev/ptmx` -> `pts/ptmx`). */
static int open_pty(const char *root, int *slave) {
  char path[PATH_MAX];
  int master, unlock = 0;
  unsigned int number;

  if (snprintf(path, sizeof(path), "%s/dev/ptmx", root) >= (int)sizeof(path)) {
    usage("root path too long");
  }

  master = open(path, O_RDWR | O_NOCTTY | O_CLOEXEC);

  if (master < 0 || ioctl(master, TIOCSPTLCK, &unlock) < 0) {
    fail("open pty");
  }

  *slave = ioctl(master, TIOCGPTPEER, O_RDWR | O_NOCTTY);

  if (*slave < 0) {
    if (ioctl(master, TIOCGPTN, &number) < 0) {
      fail("pty number");
    }

    snprintf(path, sizeof(path), "%s/dev/pts/%u", root, number);
    *slave = open(path, O_RDWR | O_NOCTTY);

    if (*slave < 0) {
      fail("open pty slave");
    }
  }

  return master;
}

static void make_directories(const char *path) {
  char buffer[PATH_MAX];
  char *slash;

  if (strlen(path) >= sizeof(buffer)) {
    return;
  }

  strcpy(buffer, path);

  for (slash = buffer + 1; (slash = strchr(slash, '/')); slash++) {
    *slash = 0;
    mkdir(buffer, 0755);
    *slash = '/';
  }

  mkdir(buffer, 0755);
}

static void close_other_fds(void) {
  int fd;

  for (fd = 3; fd < 1024; fd++) {
    close(fd);
  }
}

/* Runs in the child: becomes the command (never returns). */
static void run_command(const struct options *options, int slave) {
  char path[PATH_MAX];
  sigset_t none;

  sigemptyset(&none);
  sigprocmask(SIG_SETMASK, &none, NULL);
  signal(SIGPIPE, SIG_DFL);
  prctl(PR_SET_PDEATHSIG, SIGKILL);

  if (setsid() < 0) {
    fail("setsid");
  }

  if (options->new_ns) {
    /* PID 1 of the new namespace: its own /proc, invisible to the guest agent's mount namespace. */
    mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL);

    if (snprintf(path, sizeof(path), "%s/proc", options->root) >= (int)sizeof(path)) {
      usage("root path too long");
    }

    if (mount("proc", path, "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) < 0) {
      fail("mount /proc");
    }
  }

  if (slave >= 0) {
    if (ioctl(slave, TIOCSCTTY, 0) < 0) {
      fail("controlling terminal");
    }

    dup2(slave, 0);
    dup2(slave, 1);
    dup2(slave, 2);
  }

  close_other_fds();

  if (chroot(options->root) < 0 || chdir("/") < 0) {
    fail("chroot");
  }

  if (chdir(options->cwd) < 0) {
    /* Docker creates a missing working directory. */
    make_directories(options->cwd);

    if (chdir(options->cwd) < 0) {
      fail("working directory");
    }
  }

  if (setgroups(options->group_count, options->groups) < 0 || setgid(options->gid) < 0 ||
      setuid(options->uid) < 0) {
    fail("switch user");
  }

  execvp(options->argv[0], options->argv);
  fprintf(stderr, "exec failed: %s: %s\n", options->argv[0], strerror(errno));
  _exit(errno == ENOENT ? 127 : 126);
}

static void forward_signal(int signum) {
  if (child_pid <= 0) {
    return;
  }

  if (pty_master >= 0) {
    pid_t group = tcgetpgrp(pty_master);

    if (group > 0 && kill(-group, signum) == 0) {
      return;
    }
  }

  kill(child_pid, signum);
}

static void install_forwarding(void) {
  static const int forwarded[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2, SIGWINCH, SIGPWR};
  struct sigaction action;
  size_t index;

  memset(&action, 0, sizeof(action));
  action.sa_handler = forward_signal;
  sigemptyset(&action.sa_mask);
  action.sa_flags = SA_RESTART;

  for (index = 0; index < sizeof(forwarded) / sizeof(forwarded[0]); index++) {
    sigaction(forwarded[index], &action, NULL);
  }

  signal(SIGPIPE, SIG_IGN);
}

static int write_all(int fd, const char *data, size_t length) {
  while (length) {
    ssize_t written = write(fd, data, length);

    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }

      return -1;
    }

    data += written;
    length -= (size_t)written;
  }

  return 0;
}

static void control_line(char *line) {
  char *argv[4] = {0};
  char *save = NULL;
  int count = 0;
  char *token;

  for (token = strtok_r(line, " \t\r", &save); token && count < 4; token = strtok_r(NULL, " \t\r", &save)) {
    argv[count++] = token;
  }

  if (count == 3 && !strcmp(argv[0], "resize")) {
    set_size(pty_master, dimension(argv[1], 80), dimension(argv[2], 24));
  } else if (count == 2 && !strcmp(argv[0], "signal")) {
    int signum = atoi(argv[1]);

    if (signum == SIGHUP || signum == SIGINT || signum == SIGQUIT || signum == SIGKILL || signum == SIGUSR1 ||
        signum == SIGUSR2 || signum == SIGTERM) {
      forward_signal(signum);
    }
  }
}

/* stdin -> terminal, terminal -> stdout, control lines on fd 3; ends when the terminal closes. */
static void relay_pty(void) {
  struct pollfd fds[3];
  char buffer[65536], control[4096];
  size_t control_length = 0;
  int stdin_open = 1, control_open = fcntl(CONTROL_FD, F_GETFD) >= 0;

  for (;;) {
    nfds_t count = 0;
    int master_index, stdin_index = -1, control_index = -1;

    fds[count].fd = pty_master;
    fds[count].events = POLLIN;
    master_index = (int)count++;

    if (stdin_open) {
      fds[count].fd = 0;
      fds[count].events = POLLIN;
      stdin_index = (int)count++;
    }

    if (control_open) {
      fds[count].fd = CONTROL_FD;
      fds[count].events = POLLIN;
      control_index = (int)count++;
    }

    if (poll(fds, count, -1) < 0) {
      if (errno == EINTR) {
        continue;
      }

      return;
    }

    if (fds[master_index].revents & (POLLIN | POLLHUP | POLLERR)) {
      ssize_t length = read(pty_master, buffer, sizeof(buffer));

      if (length < 0 && errno == EINTR) {
        continue;
      }

      if (length <= 0 || write_all(1, buffer, (size_t)length) < 0) {
        return;
      }
    }

    if (stdin_index >= 0 && fds[stdin_index].revents & (POLLIN | POLLHUP | POLLERR)) {
      ssize_t length = read(0, buffer, sizeof(buffer));

      if (length > 0) {
        write_all(pty_master, buffer, (size_t)length);
      } else if (length == 0 || errno != EINTR) {
        stdin_open = 0;
      }
    }

    if (control_index >= 0 && fds[control_index].revents & (POLLIN | POLLHUP | POLLERR)) {
      ssize_t length = read(CONTROL_FD, control + control_length, sizeof(control) - 1 - control_length);
      char *newline;

      if (length <= 0) {
        if (length == 0 || errno != EINTR) {
          control_open = 0;
        }

        continue;
      }

      control_length += (size_t)length;
      control[control_length] = 0;

      while ((newline = memchr(control, '\n', control_length))) {
        size_t consumed = (size_t)(newline - control) + 1;

        *newline = 0;
        control_line(control);
        memmove(control, control + consumed, control_length - consumed);
        control_length -= consumed;
        control[control_length] = 0;
      }

      if (control_length == sizeof(control) - 1) {
        control_length = 0; /* an overlong line is dropped */
      }
    }
  }
}

static void write_pid_file(const char *path, pid_t pid) {
  char temporary[PATH_MAX], buffer[32];
  int fd, length;

  if (snprintf(temporary, sizeof(temporary), "%s.tmp", path) >= (int)sizeof(temporary)) {
    usage("pid file path too long");
  }

  fd = open(temporary, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  length = snprintf(buffer, sizeof(buffer), "%ld\n", (long)pid);

  if (fd < 0 || write_all(fd, buffer, (size_t)length) < 0 || close(fd) < 0 || rename(temporary, path) < 0) {
    fail("pid file");
  }
}

static int wait_status(void) {
  int status;

  for (;;) {
    if (waitpid(child_pid, &status, 0) < 0) {
      if (errno == EINTR) {
        continue;
      }

      return EXIT_HELPER_FAILED;
    }

    if (WIFEXITED(status)) {
      return WEXITSTATUS(status);
    }

    if (WIFSIGNALED(status)) {
      return 128 + WTERMSIG(status);
    }
  }
}

int main(int argc, char **argv) {
  struct options options;
  int slave = -1;
  unsigned short cols, rows;

  parse(&options, argc, argv);
  cols = dimension(getenv("AGENSTRA_PTY_COLS"), 80);
  rows = dimension(getenv("AGENSTRA_PTY_ROWS"), 24);
  unsetenv("AGENSTRA_PTY_COLS");
  unsetenv("AGENSTRA_PTY_ROWS");

  if (options.join_pid_file) {
    join_namespaces(options.join_pid_file);
  } else if (options.new_ns && unshare(CLONE_NEWNS | CLONE_NEWPID) < 0) {
    fail("unshare");
  }

  if (options.pty) {
    pty_master = open_pty(options.root, &slave);
    set_size(pty_master, cols, rows);
  }

  /* Signals arriving before the child exists are forwarded once it does. */
  install_forwarding();
  child_pid = fork();

  if (child_pid < 0) {
    fail("fork");
  }

  if (child_pid == 0) {
    run_command(&options, slave);
  }

  if (slave >= 0) {
    close(slave);
  }

  if (options.pid_file) {
    write_pid_file(options.pid_file, child_pid);
  }

  if (options.pty) {
    relay_pty();
  }

  return wait_status();
}
