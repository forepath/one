export type {
  ApiNodeAttrs,
  ClusterKind,
  ClusterNodeAttrs,
  ConceptNodeAttrs,
  FileDerivedNodeType,
  FileLanguageOrKind,
  FileNodeAttrs,
  KnowledgeEdge,
  KnowledgeEdgeType,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeNodeAttrs,
  KnowledgeNodeType,
  PackageNodeAttrs,
  PatchNodeAttrs,
  ProjectNodeAttrs,
  ProjectNodeKind,
  WebhookEventNodeAttrs,
} from './lib/schema';

export {
  channelApiNodeId,
  classifyTsSourceType,
  classifyTsSourceTypeFromPath,
  conceptNodeId,
  contextNodeId,
  domainNodeId,
  emailTemplateStem,
  featureGroupNodeId,
  fileNodeId,
  fileNodeTypeFromKind,
  fileNodeTypeFromPath,
  httpApiNodeId,
  isDomainProviderSource,
  isEmailTemplateFile,
  isIndexedTsSourceFile,
  isNxProjectNodeType,
  isToolsProjectRoot,
  isWebhookEventsCatalogFile,
  packageNodeId,
  patchNodeId,
  projectNodeId,
  slugify,
  toolNodeId,
  webhookEventNodeId,
} from './lib/schema';

export { buildKnowledgeGraph, writeKnowledgeGraphArtifacts } from './lib/build-knowledge-graph';
export { buildClusterSlice, inferDomainFromPath } from './lib/build-clusters';
export { fromProjectGraph } from './lib/from-project-graph';
export { discoverFiles, isNgrxStateSliceDir, isSensitivePath } from './lib/discover-files';
export { discoverToolDirectories } from './lib/discover-tools';
export { discoverPatches, parsePatchFileName } from './lib/discover-patches';
export { linkPackages } from './lib/link-packages';
export { parseOpenApi, parseOpenApiFile } from './lib/parse-openapi';
export { parseAsyncApi, parseAsyncApiFile } from './lib/parse-asyncapi';
export { parseMarkdown, parseMarkdownFile } from './lib/parse-markdown';
export {
  extractWebhookEventNames,
  parseWebhookEventsCatalog,
  parseWebhookEventsCatalogFile,
} from './lib/parse-webhook-events';
export {
  channelMatchesGateway,
  channelMatchesHint,
  channelMatchesStem,
  channelBelongsToNamespace,
  extractControllerPaths,
  extractGatewayBinding,
  extractGatewayChannelHints,
  linkImplements,
  normalizeApiPath,
  normalizeChannelToken,
  pathMatchesPrefix,
} from './lib/link-implements';
export {
  extractBalancedParenContents,
  extractConstructorInjectedTypes,
  extractExportedClassNames,
  INJECTOR_SOURCE_TYPES,
  linkInjects,
  resolveInjectableTarget,
} from './lib/link-injects';
export {
  extractBalancedBracketContents,
  extractModuleArrayIdentifiers,
  extractModuleProvidedClassNames,
  linkModuleProvides,
} from './lib/link-module-provides';
export {
  extractHttpCalls,
  extractInjectedClassTokens,
  frontendUrlToApiPath,
  linkHttpCalls,
  linkStateFacadeInjects,
  pathPatternKey,
} from './lib/link-http-calls';
export { linkStateServices } from './lib/link-state-services';
export {
  collectToolIdentifiers,
  linkToolUsage,
  projectJsonReferencesIdentifier,
  resolveToolIdentities,
} from './lib/link-tool-usage';
export { linkDocuments } from './lib/link-documents';
export {
  KnowledgeGraphIndex,
  collectImpactPaths,
  computeImpact,
  findMentions,
  recipeR1,
  recipeR2,
  recipeR3,
  recipeR5,
  resolveGraphJsonPath,
  resolveWorkspaceRoot,
} from './lib/query';
export type {
  CollectImpactPathsOptions,
  ImpactResult,
  MentionsOptions,
  MentionsResult,
  NodeSummary,
  RecipeR1Result,
  RecipeR2Result,
  RecipeR3Query,
  RecipeR3Result,
  RecipeR5Result,
} from './lib/query';
