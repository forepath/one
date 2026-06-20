class FixtureProvider {
  getType() {
    return 'fixture-provider';
  }
}

function createProvider() {
  return new FixtureProvider();
}

const providerMetadata = {
  id: 'fixture-provider',
  displayName: 'Fixture Provider',
};

module.exports = {
  createProvider,
  FixtureProvider,
  providerMetadata,
};
