import { basename, extname, join } from 'path';
import { terser } from 'rollup-plugin-terser';
import babel from 'rollup-plugin-babel';
import replace from 'rollup-plugin-replace';
import json from 'rollup-plugin-json';
import nodeResolve from 'rollup-plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import commonjs from 'rollup-plugin-commonjs';
import postcss from 'rollup-plugin-postcss-umi';
import { RollupOptions } from 'rollup';
import tempDir from 'temp-dir';
import autoprefixer from 'autoprefixer';
import NpmImport from 'less-plugin-npm-import';
import getBabelConfig from './getBabelConfig';
import { IBundleOptions } from './types';

interface IGetRollupConfigOpts {
  cwd: string;
  entry: string;
  type: 'esm' | 'cjs' | 'umd';
  target: 'browser' | 'node';
  bundleOpts: IBundleOptions;
}

interface IPkg {
  dependencies?: Object;
  peerDependencies?: Object;
}

export default function (opts: IGetRollupConfigOpts): RollupOptions[] {
  const { type, entry, cwd, target, bundleOpts } = opts;
  const {
    umd,
    esm,
    cjs,
    file,
    cssModules: modules,
    extraPostCSSPlugins = [],
    extraBabelPresets = [],
    extraBabelPlugins = [],
    autoprefixer: autoprefixerOpts,
    namedExports,
  } = bundleOpts;
  const entryExt = extname(entry);
  const name = file || basename(entry, entryExt);
  const isTypeScript = entryExt === '.ts' || entryExt === '.tsx';

  let pkg = {} as IPkg;
  try {
    pkg = require(join(cwd, 'package.json')); // eslint-disable-line
  } catch (e) {
  }

  const babelOpts = {
    ...getBabelConfig({
      target,
      typescript: false,
    }),
    exclude: 'node_modules/**',
    babelrc: false,
    // ref: https://github.com/rollup/rollup-plugin-babel#usage
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.es6', '.es', '.mjs'],
  };
  babelOpts.presets.push(...extraBabelPresets);
  babelOpts.plugins.push(...extraBabelPlugins);

  // rollup configs
  const input = join(cwd, entry);
  const format = type;
  const external = type === 'umd'
    // umd 只要 external peerDependencies
    ? [
      ...Object.keys(pkg.peerDependencies || {}),
    ]
    : [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ];

  const plugins = [
    postcss({
      modules,
      use: [
        ['less', {
          plugins: [new NpmImport({ prefix: '~' })],
          javascriptEnabled: true,
        }],
      ],
      plugins: [
        autoprefixer(autoprefixerOpts),
        ...extraPostCSSPlugins,
      ],
    }),
    ...(isTypeScript ? [typescript({
      cacheRoot: `${tempDir}/.rollup_plugin_typescript2_cache`,
      // TODO: 支持往上找 tsconfig.json
      // 比如 lerna 的场景不需要每个 package 有个 tsconfig.json
      tsconfig: join(cwd, 'tsconfig.json'),
      tsconfigDefaults: {
        compilerOptions: {
          // Generate declaration files by default
          declaration: true,
        },
      },
      tsconfigOverride: {
        compilerOptions: {
          // Support dynamic import
          target: 'esnext',
        },
      },
    })] : []),
    babel(babelOpts),
    json(),
  ];

  switch (type) {
    case 'esm':
      return [
        {
          input,
          output: {
            format,
            file: join(cwd, `dist/${esm && esm.file || `${name}.esm`}.js`),
          },
          plugins,
          external,
        },
      ];

    case 'cjs':
      return [
        {
          input,
          output: {
            format,
            file: join(cwd, `dist/${cjs && cjs.file || name}.js`),
          },
          plugins,
          external,
        },
      ];

    case 'umd':
      // Add umd related plugins
      plugins.push(
        nodeResolve({
          jsnext: true,
        }),
        commonjs({
          include: /node_modules/,
          namedExports,
        }),
      );

      return [
        {
          input,
          output: {
            format,
            file: join(cwd, `dist/${umd && umd.file || `${name}.umd`}.js`),
            globals: umd && umd.globals,
            name: umd && umd.name,
          },
          plugins: [
            ...plugins,
            replace({
              'process.env.NODE_ENV': JSON.stringify('development'),
            }),
          ],
          external,
        },
        ...(
          umd && umd.minFile === false
            ? []
            : [
                {
                  input,
                  output: {
                    format,
                    file: join(cwd, `dist/${umd && umd.file || `${name}.umd`}.min.js`),
                    globals: umd && umd.globals,
                    name: umd && umd.name,
                  },
                  plugins: [
                    ...plugins,
                    replace({
                      'process.env.NODE_ENV': JSON.stringify('production'),
                    }),
                    terser({
                      compress: {
                        pure_getters: true,
                        unsafe: true,
                        unsafe_comps: true,
                        warnings: false,
                      },
                    }),
                  ],
                  external,
                },
            ]
        ),
      ];

    default:
      throw new Error(`Unsupported type ${type}`);
  }
}
