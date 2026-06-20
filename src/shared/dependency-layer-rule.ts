/**
 * A named architectural layer matched by a glob.
 *
 * Single source of truth for the layer-rule contract shared between the firebat
 * config schema and the dependencies analyzer — a change to its shape must apply
 * to both at once.
 */
export interface DependencyLayerRule {
  readonly name: string;
  readonly glob: string;
}
