"""PTY helper for TTY exec sessions inside the Agenstra microVM (started by the guest bridge agent).

Runs argv on a fresh pseudo terminal and relays it to stdin/stdout. File descriptor 3 carries control lines
from the agent: "resize <cols> <rows>" and "signal <number>" (delivered to the terminal's foreground process
group). Exits with the command's status (128 + signal for signal deaths), like `docker exec -t`.
"""

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

CONTROL_FD = 3


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def dimension(value, fallback):
    try:
        return min(max(int(value), 1), 1000)
    except (TypeError, ValueError):
        return fallback


def write_all(fd, data):
    while data:
        try:
            written = os.write(fd, data)
        except OSError as error:
            if error.errno == errno.EINTR:
                continue
            return False
        data = data[written:]
    return True


def deliver(master, child, signum):
    try:
        os.killpg(os.tcgetpgrp(master), signum)
    except OSError:
        try:
            os.kill(child, signum)
        except OSError:
            pass


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.stderr.write("pty-helper: missing command\n")
        return 125

    cols = dimension(os.environ.pop("AGENSTRA_PTY_COLS", None), 80)
    rows = dimension(os.environ.pop("AGENSTRA_PTY_ROWS", None), 24)
    child, master = pty.fork()

    if child == 0:
        try:
            os.execvp(argv[0], argv)
        except OSError as error:
            os.write(2, ("exec failed: %s: %s\r\n" % (argv[0], error.strerror)).encode())
            os._exit(127 if error.errno == errno.ENOENT else 126)

    set_size(master, cols, rows)
    readers = [master, 0]
    control_buffer = b""

    try:
        os.fstat(CONTROL_FD)
        readers.append(CONTROL_FD)
    except OSError:
        pass

    while master in readers:
        try:
            ready, _, _ = select.select(readers, [], [])
        except InterruptedError:
            continue

        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data or not write_all(1, data):
                readers.remove(master)

        if 0 in ready:
            data = os.read(0, 65536)
            if data:
                write_all(master, data)
            else:
                readers.remove(0)

        if CONTROL_FD in ready:
            data = os.read(CONTROL_FD, 4096)
            if not data:
                readers.remove(CONTROL_FD)
                continue
            control_buffer += data
            while b"\n" in control_buffer:
                line, control_buffer = control_buffer.split(b"\n", 1)
                parts = line.decode("ascii", "replace").split()
                if len(parts) == 3 and parts[0] == "resize":
                    set_size(master, dimension(parts[1], cols), dimension(parts[2], rows))
                elif len(parts) == 2 and parts[0] == "signal" and parts[1].isdigit():
                    signum = int(parts[1])
                    if signum in (signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGKILL,
                                  signal.SIGUSR1, signal.SIGUSR2, signal.SIGTERM):
                        deliver(master, child, signum)

    _, status = os.waitpid(child, 0)
    code = os.waitstatus_to_exitcode(status)
    return 128 - code if code < 0 else code


if __name__ == "__main__":
    sys.exit(main())
