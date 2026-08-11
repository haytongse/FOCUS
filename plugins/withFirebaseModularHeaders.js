const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = "config = use_native_modules!(config_command)";
const INJECT = `
  pod 'GoogleUtilities', :modular_headers => true
  pod 'FirebaseCoreInternal', :modular_headers => true
`;

module.exports = function withFirebaseModularHeaders(config) {
  return withDangerousMod(config, ['ios', async (cfg) => {
    const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
    let contents = fs.readFileSync(podfilePath, 'utf8');
    if (!contents.includes("pod 'GoogleUtilities', :modular_headers => true")) {
      const idx = contents.indexOf(MARKER);
      if (idx !== -1) {
        contents = contents.slice(0, idx + MARKER.length) + INJECT + contents.slice(idx + MARKER.length);
        fs.writeFileSync(podfilePath, contents);
      }
    }
    return cfg;
  }]);
};
