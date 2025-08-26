module.exports = {
  env: {
    node: true,
    es2021: true,
    // ^ or set "es6: true," plus "es2021: true," for broader coverage
  },
  parserOptions: {
    ecmaVersion: 2021,
    // ^ can also do ecmaVersion: "latest" if you prefer
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    "max-len": ["warn", {"code": 120}],
    "semi": ["error", "always"],
    // Disable JSDoc validation so you don't get valid-jsdoc errors
    "valid-jsdoc": "off",
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
