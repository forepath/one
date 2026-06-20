class MountedFixtureProvider {
  getType() {
    return 'mounted-fixture-provider';
  }
}

function createProvider() {
  return new MountedFixtureProvider();
}

const providerMetadata = {
  id: 'mounted-fixture-provider',
  displayName: 'Mounted Fixture Provider',
};

module.exports = {
  createProvider,
  MountedFixtureProvider,
  providerMetadata,
};
