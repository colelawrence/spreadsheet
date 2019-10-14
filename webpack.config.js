// @ts-check
/* eslint-disable */

const path = require("path")
const HtmlWebpackPlugin = require("html-webpack-plugin")
const TerserPlugin = require("terser-webpack-plugin")

/** @param {string[]} seg */
const root = (...seg) => path.resolve(__dirname, ...seg)

const isDev = !process.env["BUILD_PROD"]
const useSourcemaps = true

/** @type {import("webpack").Configuration} */
module.exports = {
  entry: root("src/bootstrap.ts"),
  output: {
    path: root("docs"),
    // webpack has the ability to generate path info in the output bundle. However, this puts garbage collection pressure on projects that bundle thousands of modules.
    pathinfo: useSourcemaps,
    devtoolModuleFilenameTemplate:
      "source://[namespace]/[resource-path]?[loaders]",
  },
  //
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: require.resolve("ts-loader"),
          options: {
            transpileOnly: isDev,
            experimentalWatchApi: isDev,
            compilerOptions: {
              sourceMap: useSourcemaps,
              baseUrl: root(),
            },
          },
        },
        include: [root("src")],
      },
    ],
  },
  devtool: isDev
    ? useSourcemaps
      ? "inline-source-map"
      : "eval"
    : "source-map",
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js"],
    alias: {
      // react: "preact/compat",
      // "react-dom": "preact/compat",
    },
  },
  mode: isDev ? "development" : "production",
  plugins: [
    new HtmlWebpackPlugin({
      template: root("index.ejs"),
    }),
  ],
  stats: {
    // Examine all modules
    maxModules: Infinity,
    // Display bailout reasons
    optimizationBailout: true,
  },
  optimization: isDev
    ? {
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      }
    : {
        minimize: true,
        minimizer: [
          new TerserPlugin({
            cache: true,
            parallel: true,
            sourceMap: useSourcemaps, // Must be set to true if using source-maps in production
            terserOptions: {
              output: {
                comments: false
              }
              // https://github.com/webpack-contrib/terser-webpack-plugin#terseroptions
            },
          }),
        ],
        removeEmptyChunks: true,
        usedExports: true,
        providedExports: true,
        mergeDuplicateChunks: true,
        sideEffects: true,
        removeAvailableModules: true,
        concatenateModules: true,
      },
}
