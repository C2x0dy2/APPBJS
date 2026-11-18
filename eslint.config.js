// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions tourne sous Deno (pas Node/React Native) : autre environnement, autres règles.
    ignores: ["dist/*", "supabase/functions/**"],
  }
]);
