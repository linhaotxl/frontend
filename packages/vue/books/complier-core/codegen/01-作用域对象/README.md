<!-- TOC -->

- [作用域对象](#作用域对象)
- [代码生成流程](#代码生成流程)
    - [生成 module 模式下开始部分代码 —— genModulePreamble](#生成-module-模式下开始部分代码--genmodulepreamble)
    - [生成 function 模式下开始部分代码 —— genFunctionPreamble](#生成-function-模式下开始部分代码--genfunctionpreamble)
    - [生成静态节点 —— genHoists](#生成静态节点--genhoists)
    - [生成资源 —— genAssets](#生成资源--genassets)

<!-- /TOC -->

经过前面两步过程，我们已经完成了对 `AST` 的生成以及转换，接下来只剩最后一步，就是将 `AST` 节点生成为实际可执行代码，也就是组件的 “渲染函数”  
接下来就来了解代码生成的部分  

## 作用域对象
每个步骤都会有一个作用域对象，这个阶段也不例外，先来看看创建作用域的配置结构  

```ts
export interface CodegenOptions extends SharedTransformCodegenOptions {
    /**
     * 代码模式
     * module：会生成 ES Module 模式，通过 import 导入帮助函数，export 出渲染函数
     * function：会生成函数，通过“对象解构”从全局变量中解构出帮助函数，并 return 渲染函数
     * @default 'function'
     */
    mode?: 'module' | 'function'
    /**
     * 是否生成 sourceMap 文件
     * @default false
     */
    sourceMap?: boolean
    /**
     * 单文件组件中样式 style 的 ID
     */
    scopeId?: string | null
    /**
     * 通过赋值的形式，优化导入，只用在 webpack 的 code-split
     * @default false
     */
    optimizeImports?: boolean
    /**
     * module 模式下 import 的模块名
     * @default 'vue'
     */
    runtimeModuleName?: string
    /**
     * function 模式下 解构的 的全局变量名
     * @default 'Vue'
     */
    runtimeGlobalName?: string
}
```  

注意，`CodegenOptions` 继承了 `SharedTransformCodegenOptions`，不要忘了继承的属性  

接下来看作用域的创建  

```ts
function createCodegenContext(
    ast: RootNode,
    {
        mode = 'function',
        prefixIdentifiers = mode === 'module',
        sourceMap = false,
        filename = `template.vue.html`,
        scopeId = null,
        optimizeImports = false,
        runtimeGlobalName = `Vue`,
        runtimeModuleName = `vue`,
        ssr = false
    }: CodegenOptions
): CodegenContext {
    const context: CodegenContext = {
        mode,               // 渲染函数模式
        prefixIdentifiers,  // 是否增加前缀
        sourceMap,
        filename,
        scopeId,
        optimizeImports,
        runtimeGlobalName,
        runtimeModuleName,
        ssr,
        source: ast.loc.source, // 源代码
        code: ``,               // 渲染函数代码
        column: 1,
        line: 1,
        offset: 0,
        indentLevel: 0,         // 代码缩进级别
        pure: false,            // 是否需要生成纯函数注释
        map: undefined,
        
        /**
         * 获取各个模块的私有名称
         */
        helper(key) {
            return `_${helperNameMap[key]}`
        },
        
        /**
         * 插入代码
         */
        push(code, node) {
            // 直接追加在 context.code 后面
            context.code += code
            if (!__BROWSER__ && context.map) {
                if (node) {
                    let name
                    if (node.type === NodeTypes.SIMPLE_EXPRESSION && !node.isStatic) {
                        const content = node.content.replace(/^_ctx\./, '')
                        if (content !== node.content && isSimpleIdentifier(content)) {
                            name = content
                        }
                    }
                    addMapping(node.loc.start, name)
                }
                advancePositionWithMutation(context, code)
                if (node && node.loc !== locStub) {
                    addMapping(node.loc.end)
                }
            }
        },

        /**
         * 换行并缩进，缩进级别 + 1，调用换行函数
         */
        indent() {
            newline(++context.indentLevel)
        },

        /**
         * 减小缩进，并根据参数决定是否换行
         * @param { boolean } withoutNewLine 
         */
        deindent(withoutNewLine = false) {
            if (withoutNewLine) {
                // 不换行，只减小缩进级别
                --context.indentLevel
            } else {
                // 换行，减小缩进级别，再调用换行函数
                newline(--context.indentLevel)
            }
        },
        
        /**
         * 换行，并缩进当前级别
         */
        newline() {
            newline(context.indentLevel)
        }
    }

    /**
     * 换行，先插入换行符，并按照缩进级别插入 2*n 个空白符
     * 一个级别对应两个空白符
     * @param { number } n 缩进级别
     */
    function newline(n: number) {
        context.push('\n' + `  `.repeat(n))
    }

    function addMapping(loc: Position, name?: string) {
        context.map!.addMapping({
            name,
            source: context.filename,
            original: {
                line: loc.line,
                column: loc.column - 1 // source-map column is 0 based
            },
            generated: {
                line: context.line,
                column: context.column - 1
            }
        })
    }

    if (!__BROWSER__ && sourceMap) {
        // lazy require source-map implementation, only in non-browser builds
        context.map = new SourceMapGenerator()
        context.map!.setSourceContent(filename, context.source)
    }

    return context
}
```  

## 代码生成流程  
创建完作用域后，就开始对 `AST` 节点生成代码了，先来看看代码生成结果的结构  

```ts
export interface CodegenResult {
    code: string        // 生成代码
    preamble: string
    ast: RootNode       // 源代码的 AST 节点
    map?: RawSourceMap  // sourceMap 对象
}
```  

接下来看具体的实现过程  

```ts
export function generate(
    ast: RootNode,
    options: CodegenOptions & {
        onContextCreated?: (context: CodegenContext) => void
    } = {}
): CodegenResult {
    // 1. 创建作用域
    const context = createCodegenContext(ast, options)
    // 2. 调用作用域创建完成的钩子函数
    if (options.onContextCreated) options.onContextCreated(context)
    const {
        mode,
        push,
        prefixIdentifiers,
        indent,
        deindent,
        newline,
        scopeId,
        ssr
    } = context

    // 3. 是否存在模块函数
    const hasHelpers = ast.helpers.length > 0
    // 4. 是否要使用 with 语句
    const useWithBlock = !prefixIdentifiers && mode !== 'module'
    // 5. 是否要生成 scopeId
    const genScopeId = !__BROWSER__ && scopeId != null && mode === 'module'
    // 6. 
    const isSetupInlined = !__BROWSER__ && !!options.inline

    // 7. 
    const preambleContext = isSetupInlined
        ? createCodegenContext(ast, options)
        : context
    
    // 8. 生成开始部分的内容，包括各个模块的导入，静态节点的生成
    if (!__BROWSER__ && mode === 'module') {
        // 生成 module 模式的内容
        genModulePreamble(ast, preambleContext, genScopeId, isSetupInlined)
    } else {
        // 生成 function 模式的内容
        genFunctionPreamble(ast, preambleContext)
    }

    /**
     * 经过上一步，已经生成了 export 或者 return 关键字，所以接下来开始生成渲染函数
     */
     
    // 9. 入口函数名
    const functionName = ssr ? `ssrRender` : `render`
    // 10. 入口函数参数
    const args = ssr ? ['_ctx', '_push', '_parent', '_attrs'] : ['_ctx', '_cache']
    // 11. 
    if (!__BROWSER__ && options.bindingMetadata && !options.inline) {
        // binding optimization args
        args.push('$props', '$setup', '$data', '$options')
    }
    // 12. 参数签名
    const signature =
        !__BROWSER__ && options.isTS
            ? args.map(arg => `${arg}: any`).join(',')
            : args.join(', ')

    // 13. 检测是否需要生成 scopeId
    if (genScopeId) {
        if (isSetupInlined) {
            push(`${PURE_ANNOTATION}_withId(`)
        } else {
            // 如果不是行内模式，那么会先调用 _withId(这个函数在 genModulePreamble 中调用 withScopeId 生成)，它只有一个参数，就是渲染函数
            // 例如 const render = _withId(
            push(`const ${functionName} = ${PURE_ANNOTATION}_withId(`)
        }
    }

    // 14. 生成渲染函数
    if (isSetupInlined || genScopeId) {
        // 如果存在 scopeId，则渲染函数为箭头函数
        push(`(${signature}) => {`)
    } else {
        // 否则就是普通函数
        push(`function ${functionName}(${signature}) {`)
    }

    // 15. 接下来的内容都在函数体内部，换行缩进
    indent()

    // 16. 检测是否需要用 with 语句
    if (useWithBlock) {
        // 增加 with 语句块
        push(`with (_ctx) {`)
        // 接下来的内容都在 with 语句内，换行缩进
        indent()
        if (hasHelpers) {
            // 增加从 vue 中导入常量模块的声明，应该处于 with 语句块中，并修改模块名称(增加 _)，避免冲突
            push(
                `const { ${ast.helpers
                .map(s => `${helperNameMap[s]}: _${helperNameMap[s]}`)
                .join(', ')} } = _Vue`
            )
            // 增加换行，这个是 const {} = _Vue 后的换行
            push(`\n`)
            // 再次换行，这个是 const {} = _Vue 和下一句代码间的换行
            newline()
        }
    }

    // 17. 生成组件导入语句
    if (ast.components.length) {
        genAssets(ast.components, 'component', context)
        if (ast.directives.length || ast.temps > 0) {
            newline()
        }
    }
    // 18. 生成指令导入语句
    if (ast.directives.length) {
        genAssets(ast.directives, 'directive', context)
        if (ast.temps > 0) {
            newline()
        }
    }
    // 19. 生成临时变量定义语句
    if (ast.temps > 0) {
        push(`let `)
        for (let i = 0; i < ast.temps; i++) {
            push(`${i > 0 ? `, ` : ``}_temp${i}`)
        }
    }
    // 20. 存在资源换行
    if (ast.components.length || ast.directives.length || ast.temps) {
        push(`\n`)
        newline()
    }

    // 21. 非服务端渲染下，生成 return 语句，这是渲染函数的 return
    if (!ssr) {
        push(`return `)
    }

    // 22. 从根节点的生成器开始，依次往下生成对应的代码
    if (ast.codegenNode) {
        genNode(ast.codegenNode, context)
    } else {
        push(`null`)
    }

    // 23. 减小缩进并换行，生成 }，对应 with 语句
    if (useWithBlock) {
        deindent()
        push(`}`)
    }

    // 24. 减小缩进并换行，生成 }，对应渲染函数
    deindent()
    push(`}`)

    // 25. 生成 scopeId 调用结束的 )
    if (genScopeId) {
        push(`)`)
    }

    // 26. 返回结果
    return {
        ast,
        code: context.code,
        preamble: isSetupInlined ? preambleContext.code : ``,
        // SourceMapGenerator does have toJSON() method but it's not in the types
        map: context.map ? (context.map as any).toJSON() : undefined
    }
}
```  

### 生成 module 模式下开始部分代码 —— genModulePreamble  
这个函数用来创建 `module` 模式下开头的代码，例如各个模块的引入、静态节点的创建等  
由于是 `module` 模式，所以是需要导出渲染函数的，还有导出部分代码的创建  
注意，在这个函数执行前，`context.code` 还是空的，没有任何内容  

接下来看具体实现  

```ts
function genModulePreamble(
    ast: RootNode,              // 根节点
    context: CodegenContext,    // 作用域对象
    genScopeId: boolean,        // 是否生成 scopeId
    inline?: boolean            // 是否是行内模式
) {
    const {
        push,
        helper,
        newline,
        scopeId,
        optimizeImports,
        runtimeModuleName
    } = context

    // 1. 处理生成 scopeId 的情况
    if (genScopeId) {
        // 向帮助模块中添加 WITH_SCOPE_ID 以供后续 import 进来
        ast.helpers.push(WITH_SCOPE_ID)
        // 如果存在静态节点，在向帮助模块列表中添加 PUSH_SCOPE_ID 和 POP_SCOPE_ID 以供后续 import 进来
        if (ast.hoists.length) {
            ast.helpers.push(PUSH_SCOPE_ID, POP_SCOPE_ID)
        }
    }

    // 2. 生成各个模块下的 import 语句
    if (ast.helpers.length) {
        if (optimizeImports) {

        } else {
            // 将每个帮助模块的名称修改为 _名称，并从运行时模块 runtimeModuleName 中导入，例如
            // import { openBlock as _openBlock, createBlock as _createBlock } from 'vue'
            push(
                `import { ${ast.helpers
                    .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
                    .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`
            )
        }
    }

    // 3. 生成服务端渲染下，各个模块的 import 语句
    //    将每个帮助模块的名称修改为 _名称，并从 @vue/server-renderer 中导入，例如
    if (ast.ssrHelpers && ast.ssrHelpers.length) {
        push(
        `import { ${ast.ssrHelpers
            .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
            .join(', ')} } from "@vue/server-renderer"\n`
        )
    }

    if (ast.imports.length) {
        genImports(ast.imports, context)
        newline()
    }

    // 5. 处理 scopeId，例如
    //    const _withId = /*#__PURE__*/_withScopeId("xxx")
    if (genScopeId) {
        push(
            `const _withId = ${PURE_ANNOTATION}${helper(WITH_SCOPE_ID)}("${scopeId}")`
        )
        newline()
    }

    // 6. 生成静态节点
    genHoists(ast.hoists, context)

    // 7. 换行
    newline()

    // 8. 生成导出关键字 export 
    if (!inline) {
        push(`export `)
    }
}
```  

### 生成 function 模式下开始部分代码 —— genFunctionPreamble  
这个函数用来创建 `function` 模式下开头的代码，和 [module]() 不同，`function` 下又有两种模式，这两种模式根据 `prefixIdentifiers` 来区分  

1. 前缀模式，模板中的变量均添加前缀 `_ctx` 表示来源，例如  

```html
<span>{{ name }}</span>
```  
生成渲染函数为  

```ts
return function render(_ctx, _cache, $props, $setup, $data, $options) {
    return (_openBlock(), _createBlock("span", null, _toDisplayString(_ctx.name), 1 /* TEXT */))
}
```  

这种模式下，会将各个模块在一开始就解构出来  

2. `with` 模式(不需要前缀)，渲染函数中所有代码用 `with` 语句包裹，这样模板中的变量不会增加前缀，等到执行时，会自动去 `with` 的作用域中查找，例如  

```html
<span>{{ name }}</span>
```  
生成渲染函数为  

```ts
return function render(_ctx, _cache, $props, $setup, $data, $options) {
    with (_ctx) {
        const { toDisplayString: _toDisplayString, openBlock: _openBlock, createBlock: _createBlock } = _Vue
        return (_openBlock(), _createBlock("span", null, _toDisplayString(name), 1 /* TEXT */))
    }
}
```  

这种模式下，各个模块的解构并不会发生在一开始，而是在 `with` 内的开始，但还有一种特殊情况，就是存在静态节点  
此时会将与静态节点相关的模块提出到函数外面去解构  

```ts
function genFunctionPreamble(
    ast: RootNode,          // 根节点
    context: CodegenContext // 作用域
) {
    const {
        ssr,
        prefixIdentifiers,
        push,
        newline,
        runtimeModuleName,
        runtimeGlobalName
    } = context

    // 1. 获取需要
    //    服务端从 require("vue") 中引入
    //    浏览器直接从全局变量 Vue 中解构
    const VueBinding =
        !__BROWSER__ && ssr
            ? `require(${JSON.stringify(runtimeModuleName)})`
            : runtimeGlobalName

    // 2. 定义 将模块名转换为私有模块 的函数
    const aliasHelper = (s: symbol) => `${helperNameMap[s]}: _${helperNameMap[s]}`

    // 3. 处理存在模块的情况
    if (ast.helpers.length > 0) {
        // 前缀模式，将所有模块解构出来
        if (!__BROWSER__ && prefixIdentifiers) {
            push(
                `const { ${ast.helpers.map(aliasHelper).join(', ')} } = ${VueBinding}\n`
            )
        }
        // with 模式
        else {
            // 插入代码：将 Vue 保存在单独的变量中，避免冲突
            push(`const _Vue = ${VueBinding}\n`)
            // 处理静态节点，若存在以下四种的模块，将它们解构在一开始
            if (ast.hoists.length) {
                const staticHelpers = [
                    CREATE_VNODE,
                    CREATE_COMMENT,
                    CREATE_TEXT,
                    CREATE_STATIC
                ]
                    .filter(helper => ast.helpers.includes(helper))
                    .map(aliasHelper)
                    .join(', ')
                push(`const { ${staticHelpers} } = _Vue\n`)
            }
        }
    }

    // 4. 生成服务端渲染下，各个模块的解构
    if (!__BROWSER__ && ast.ssrHelpers && ast.ssrHelpers.length) {
        push(
            `const { ${ast.ssrHelpers
                .map(aliasHelper)
                .join(', ')} } = require("@vue/server-renderer")\n`
        )
    }

    // 5. 生成静态节点
    genHoists(ast.hoists, context)

    // 6. 换行
    newline()

    // 7. 生成返回渲染函数的 return
    push(`return `)
}
```  

### 生成静态节点 —— genHoists  
这个函数只会被调用在上面两个函数内，且都是在导入各个模块的后面，渲染函数之前，是因为静态节点需要在这里执行  

接下来看具体实现  

```ts
function genHoists(
    hoists: (JSChildNode | null)[], // 静态节点列表
    context: CodegenContext         // 作用域
) {
    // 1. 不存在静态节点，什么也不做，直接退出
    if (!hoists.length) {
        return
    }

    // 2. 标识需要添加纯函数注释
    context.pure = true
    
    const { push, newline, helper, scopeId, mode } = context

    // 3. 是否需要生产 scopeId
    const genScopeId = !__BROWSER__ && scopeId != null && mode !== 'function'

    // 4. 换行
    newline()

    // 5. 需要生成 scopeId 的话，调用 pushScopeId("scopeId")
    if (genScopeId) {
        push(`${helper(PUSH_SCOPE_ID)}("${scopeId}")`)
        newline()
    }

    // 6. 遍历静态节点列表
    hoists.forEach((exp, i) => {
        if (exp) {
            // 生成静态节点定义，例如 const _hoisted_1 = 
            push(`const _hoisted_${i + 1} = `)
            // 通过 genNode 解析每个静态节点，这函数在后面会讲到
            genNode(exp, context)
            // 换行
            newline()
        }
    })

    // 7. 需要生成 scopeId 的话，调用 popScopeId，和第 5 步对应
    if (genScopeId) {
        push(`${helper(POP_SCOPE_ID)}()`)
        newline()
    }

    // 8. 取消纯函数注释标记
    context.pure = false
}
```  

### 生成资源 —— genAssets   
这个函数用来生成解析组件、指令的代码  
直接来看具体实现  

```ts
function genAssets(
    assets: string[],                           // 资源名称列表
    type: 'component' | 'directive',            // 资源类型
    { helper, push, newline }: CodegenContext   // 作用域
) {
    // 获取解析资源的函数
    // 组件 -> resolveComponent
    // 指令 -> resolveDirective
    const resolver = helper(
        type === 'component' ? RESOLVE_COMPONENT : RESOLVE_DIRECTIVE
    )

    // 遍历资源列表
    for (let i = 0; i < assets.length; i++) {
        const id = assets[i]
        // 插入解析资源的代码
        // 例如 const _component_foo = resolveComponent("foo")
        push(
            `const ${toValidAssetId(id, type)} = ${resolver}(${JSON.stringify(id)})`
        )
        // 如果还没有到最后一个，换行
        if (i < assets.length - 1) {
            newline()
        }
    }
}
```  
