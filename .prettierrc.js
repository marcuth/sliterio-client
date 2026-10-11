module.exports = {
    "semi": false,
    "singleQuote": false,
    "tabWidth": 4,
    "useTabs": false,
    "plugins": ["@ianvs/prettier-plugin-sort-imports"],
    "importOrder": [
        "^node:(.*)$",
        "",
        "<THIRD_PARTY_MODULES>",
        "",
        "^[./]"
    ],
    "importOrderParserPlugins": ["typescript", "jsx"],
    "importOrderTypeScriptVersion": "5.0.0",
    "endOfLine": "auto",
    "printWidth": 120
}