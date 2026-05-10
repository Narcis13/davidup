export {
  RefResolutionError,
  resolveImports,
  type ReadFile,
  type RefErrorCode,
  type ResolveImportsOptions,
} from "./imports.js";
export { evaluatePointer, JsonPointerError } from "./jsonPointer.js";
export {
  expandBehavior,
  expandBehaviors,
  getBehaviorDescriptor,
  hasBehavior,
  listBehaviors,
  type BehaviorBlock,
  type BehaviorDescriptor,
  type BehaviorParamDescriptor,
  type BehaviorParamType,
} from "./behaviors.js";
export {
  expandTemplate,
  expandTemplates,
  getTemplateDefinition,
  hasTemplate,
  listTemplates,
  registerTemplate,
  type ExpandedTemplate,
  type TemplateDefinition,
  type TemplateDescriptor,
  type TemplateInstance,
  type TemplateParamDescriptor,
  type TemplateParamType,
} from "./templates.js";
export { BUILT_IN_TEMPLATE_IDS } from "./builtInTemplates.js";
export {
  expandSceneInstance,
  expandSceneInstances,
  getSceneDefinition,
  hasScene,
  listScenes,
  readSceneDefinition,
  registerScene,
  unregisterScene,
  type ExpandedScene,
  type ExpandSceneOptions,
  type SceneDefinition,
  type SceneDescriptor,
  type SceneInstance,
  type SceneParamDescriptor,
  type SceneParamType,
  type SceneSize,
} from "./scenes.js";
export { substitute, type SubstitutionContext } from "./params.js";
export { precompile, type PrecompileOptions } from "./precompile.js";
