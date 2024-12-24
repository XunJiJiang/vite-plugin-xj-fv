import * as sass from 'sass'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { type Plugin, type ResolvedConfig } from 'vite'

type Options = {
  scss?: {
    global?: false | string
  }
}

const updateGlobalScss = (option: Options | void) => {
  const globalScss =
    typeof option?.scss?.global === 'string'
      ? (() => {
          try {
            return readFileSync(option.scss.global, 'utf-8')
          } catch (error) {
            console.error('error:', error)
            return ''
          }
        })()
      : ''

  return globalScss
}

export default (option: Options | void): Plugin => {
  let config: ResolvedConfig

  /** 用于在生产环境保存css, 文件指纹等信息 */
  const indexCss = {
    code: '',
    fileName: '',
    oldFileName: ''
  }

  const createFileHash = (code: string) => {
    return createHash('md5').update(code).digest('hex').slice(0, 8)
  }

  let globalScss = updateGlobalScss(option)

  let globalScssToCss: { css: string }

  let isFirstCss = true

  const compileScss = (code: string, isShadow = false) => {
    const _scss = code.replace('export default "', '').slice(0, -1).split('\\n')
    const _otherList: string[] = []
    const _importList = _scss.filter((item) => {
      if (item.startsWith('@use') || item.startsWith('@import')) {
        return true
      }
      _otherList.push(item)
      return false
    })
    const _code = sass.compileString(
      _importList.join('\n') + '\n' + globalScss + '\n' + _otherList.join('\n'),
      { style: config.command === 'serve' ? 'expanded' : 'compressed' }
    )
    if (config.command === 'serve') {
      const code = _code.css
        .toString()
        .replace(
          isFirstCss
            ? ((isFirstCss = false), '/**/')
            : globalScssToCss!.css.toString(),
          ''
        )
      return (
        'export default `' +
        (isShadow ? code : ((indexCss.code += code), '')) +
        '`'
      )
    } else {
      // 将全部的样式放在一个css文件中, 使用link引入, 每次使用vite的功能生成对应文件指纹
      indexCss.code +=
        indexCss.code === ''
          ? _code.css.toString()
          : _code.css.toString().replace(globalScssToCss!.css.toString(), '')
      // TODO: 应当使得此时不返回任何内容
      return 'export default ""'
    }
  }

  return {
    name: 'vite-plugin-raw-after-compile',
    configResolved(resolvedConfig) {
      // 存储最终解析的配置
      config = resolvedConfig
      globalScssToCss = sass.compileString(globalScss, {
        style: config.command === 'serve' ? 'expanded' : 'compressed'
      })
    },
    transform(code, id) {
      if (id.endsWith('.scss')) {
        globalScss = updateGlobalScss(option)
      }

      const fileId = id.split('/').pop()?.split('.').pop() || ''
      const fileType = fileId.split('?')[0]
      const params =
        fileId
          .split('?')[1]
          ?.split('&')
          .reduce(
            (acc, cur) => {
              const [key, value] = cur.split('=')
              acc[key] = value ?? null
              return acc
            },
            {} as Record<string, string>
          ) ?? {}

      // TODO: 使用inline时sass处理会报错
      if ('raw' in params || 'inline' in params) {
        const paramValue = params['raw'] ?? params['inline']
        if (fileType === 'scss') {
          try {
            // TODO: 此处字体文件的处理有问题
            // 使用shadow根的元素不会受到全局样式影响, 同时其子元素也不会受到全局样式影响
            // 当某个元素使用shadow根时, 子元素也需要启用shadow根
            const result = compileScss(code, paramValue === 'shadow')
            // TODO: 可能需要引入`@use '@assets/scss/global.scss' as *;`, 目前来看并不需要
            return {
              code: result,
              map: null
            }
          } catch (error) {
            console.error('error:', error)
          }
        }
      }
    },
    transformIndexHtml(html) {
      if (config.command === 'serve') {
        return html
      }
      // TODO: 此处字体文件的处理有问题
      return html.replace(
        `<link rel="stylesheet" crossorigin href="${config.base}${indexCss.oldFileName}">`,
        `<link rel="stylesheet" crossorigin href="${config.base}${indexCss.fileName}">`
      )
    },
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const file = bundle[fileName]

        if (
          file.type === 'asset' &&
          fileName.endsWith('.css') &&
          fileName.startsWith('assets/index-') &&
          typeof file.source === 'string'
        ) {
          file.source += indexCss.code.replace(
            file.source.includes(globalScssToCss!.css.toString())
              ? globalScssToCss!.css.toString()
              : ((isFirstCss = false), '/**/'),
            ''
          )

          indexCss.oldFileName = fileName

          // 更新文件的内容哈希（如果需要）
          const hash = createFileHash(file.source)
          const newFileName = fileName.replace(
            /index-(.*).css/,
            `index-${hash}.css`
          )

          indexCss.fileName = newFileName

          // 修改文件名
          file.fileName = newFileName
          delete bundle[fileName]
          bundle[newFileName] = file
        }
      }
    },
    config() {
      return {
        esbuild: {
          jsxFactory: '__jsx.h',
          jsxFragment: '__jsx.Fragment',
          jsxInject: `import { __jsx, $if, $elseif, $else, $for } from 'xj-fv'`
        }
      }
    }
  }
}
