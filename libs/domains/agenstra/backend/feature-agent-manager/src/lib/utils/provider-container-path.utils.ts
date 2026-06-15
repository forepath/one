/**
 * Expand a leading `~` in a provider path using the container user's HOME.
 * Used for provider config roots (e.g. `~/.cursor`) and kept in sync with file operations.
 */
export async function expandProviderPathTildeInContainer(
  providerPath: string,
  containerId: string,
  getContainerHomeDirectory: (id: string) => Promise<string>,
): Promise<string> {
  if (providerPath === '~') {
    return await getContainerHomeDirectory(containerId);
  }

  if (providerPath.startsWith('~/')) {
    const home = await getContainerHomeDirectory(containerId);

    return `${home}${providerPath.slice(1)}`;
  }

  return providerPath;
}
