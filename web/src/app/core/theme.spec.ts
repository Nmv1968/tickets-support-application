import config from '../../../angular.json';

/**
 * The part of the build settings this spec looks at. Loose on purpose (any other setting is
 * allowed, and this one may be missing or have another shape): a setting that was removed or
 * reshaped must fail the test, not the compilation.
 */
interface BuildSettings {
  optimization?: boolean | { styles?: boolean | { inlineCritical?: boolean } };
  [setting: string]: unknown;
}

// Theme.palette reads the colours of the charts from the stylesheet, once per theme, and keeps
// them. With "inlineCritical" (the default of a production build) the stylesheet is loaded
// late, after the script may already have read them: the charts then stay without colours.
// Nothing in the application code fails when the setting is lost, so it is checked here.
describe('The production build', () => {
  it('does not load the stylesheet late: Theme.palette reads the colours from it', () => {
    const production: BuildSettings = config.projects.web.architect.build.configurations.production;
    const optimization = typeof production.optimization === 'object' ? production.optimization : undefined;
    const styles = typeof optimization?.styles === 'object' ? optimization.styles : undefined;

    expect(styles?.inlineCritical).toBeFalse();
  });
});
