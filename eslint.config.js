const esbuild = require("esbuild")
const espree = require("espree")
const prettierPlugin = require("eslint-plugin-prettier")

const tsParser = {
    parse(text, options = {}) {
        const js = esbuild.transformSync(text, {
            loader: "ts",
            sourcefile: options.filePath || "file.ts",
        }).code
        return espree.parse(js, {
            ecmaVersion: "latest",
            sourceType: "module",
            tokens: true,
            comment: true,
            loc: true,
            range: true,
        })
    },
}

module.exports = [
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            sourceType: "module",
            ecmaVersion: "latest",
        },
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            "no-unused-vars": "off",
            "prettier/prettier": "error",
        },
    },
]
