export {
  RefResolutionError,
  resolveImports,
  type ReadFile,
  type RefErrorCode,
  type ResolveImportsOptions,
} from "./imports.js";
export { evaluatePointer, JsonPointerError } from "./jsonPointer.js";
export {
  resolveLibraryRefs,
  type ResolveLibraryRefsOptions,
} from "./libraryRefs.js";
export {
  BEHAVIOR_EXPANSION_VERSION,
  expandBehavior,
  expandBehaviors,
  getBehaviorDefinition,
  getBehaviorDescriptor,
  hasBehavior,
  listBehaviors,
  normalizeBehaviorDescriptor,
  registerBehavior,
  unregisterBehavior,
  type BehaviorBlock,
  type BehaviorDescriptor,
  type BehaviorParamDescriptor,
  type BehaviorParamType,
  type ExpandBehaviorOptions,
} from "./behaviors.js";
export {
  TEMPLATE_EXPANSION_VERSION,
  expandTemplate,
  expandTemplates,
  getTemplateDefinition,
  hasTemplate,
  listTemplates,
  registerTemplate,
  templateDescriptor,
  unregisterTemplate,
  type ExpandedTemplate,
  type TemplateDefinition,
  type TemplateDescriptor,
  type TemplateInstance,
  type TemplateParamDescriptor,
  type TemplateParamType,
} from "./templates.js";
export { BUILT_IN_TEMPLATE_IDS } from "./builtInTemplates.js";
export {
  SCENE_EXPANSION_VERSION,
  expandSceneInstance,
  expandSceneInstances,
  getSceneDefinition,
  hasScene,
  listScenes,
  readSceneDefinition,
  registerScene,
  sceneDescriptor,
  unregisterScene,
  type ExpandedScene,
  type ExpandSceneOptions,
  type SceneDefinition,
  type SceneDescriptor,
  type SceneInstance,
  type SceneParamDescriptor,
  type SceneParamType,
  type SceneSize,
  type TimeMapping,
} from "./scenes.js";
export { substitute, type SubstitutionContext } from "./params.js";
export {
  synthesizeVideoAudio,
  videoAudioTrackId,
  VIDEO_AUDIO_TRACK_SUFFIX,
} from "./videoAudio.js";
export {
  precompile,
  type PrecompileOptions,
  type PrecompileResult,
} from "./precompile.js";
// Source-map types live on the engine layer so engine-side consumers can
// import them without a dependency on compose; re-exported here for callers
// already importing from `compose`.
export type {
  OriginKind,
  SourceLocation,
  SourceMap,
} from "../engine/types.js";
