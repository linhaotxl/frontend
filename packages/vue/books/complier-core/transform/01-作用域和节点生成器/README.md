<!-- TOC -->

- [什么是转换](#什么是转换)
- [节点类型](#节点类型)
- [作用域](#作用域)

<!-- /TOC -->

## 什么是转换
经过 **parse**，我们完成了编译的第一步，得到了 `AST` 节点，从这章开始，会进入第二步 —— 转换(Trasnform)  

转换就是改写原本的 `AST` 节点，成为我们需要的类型  
例如，我们将 `v-if` 指令，转换为了两个节点，一个是满足条件需要渲染的节点，一个是不满足条件渲染的节点，如下  

```html
<div v-if="a">Hello World!</div>
```  

转换后  

```ts
(_ctx.a)
    ? (_openBlock(), _createBlock("div", { key: 0 }, "Hello World!"))
    : _createCommentVNode("v-if", true)
```  

为什么会将 `a` 转换为 `_ctx.a`？  
为什么 `div` 会开启一个 `block`？  
为什么 `div` 的 key 是 `0`？  

这些问题的答案都会在这章中解释  

## 节点类型  
在 “parse” 阶段，已经介绍过 `NodeTypes` 的部分类型，现在对其进行补充  

```ts
export const enum NodeTypes {
    /* parse 阶段介绍过的类型 */
    // containers
    COMPOUND_EXPRESSION,        // 合成表达式
    IF,                         // v-if 节点
    IF_BRANCH,                  // v-if 的分支节点
    FOR,                        // v-for 节点
    TEXT_CALL,        
              
    // codegen
    VNODE_CALL,
    
    // 下面几种类型对应 JS 中的数据类型
    JS_CALL_EXPRESSION,         // 函数调用节点
    JS_OBJECT_EXPRESSION,       // 对象节点
    JS_PROPERTY,                // 对象属性节点
    JS_ARRAY_EXPRESSION,        // 数组节点
    JS_FUNCTION_EXPRESSION,     // 函数定义节点
    JS_CONDITIONAL_EXPRESSION,  
    JS_CACHE_EXPRESSION,
}
```  

在接下的小节中会依次介绍到这些类型的具体用法，现在只需要知道还存在这些类型即可  

## 作用域   
“Transform” 阶段也存在一个作用域对象，包含了这个阶段会用到的一些属性和方法  

```ts
export interface TransformOptions extends SharedTransformCodegenOptions {
    // 节点转换的钩子函数
    nodeTransforms?: NodeTransform[]

    // 指令转换钩子集合，其中 key 是指令名，value 是转换函数
    directiveTransforms?: Record<string, DirectiveTransform | undefined>

    transformHoist?: HoistTransform | null

    isBuiltInComponent?: (tag: string) => symbol | void

    isCustomElement?: (tag: string) => boolean | void

    // 是否增加标识前缀，即增加数据来源
    // 例如在模板中 {{ name }}，会被转换为 {{ _ctx.name }}
    prefixIdentifiers?: boolean

    hoistStatic?: boolean

    cacheHandlers?: boolean

    expressionPlugins?: ParserPlugin[]

    scopeId?: string | null

    ssrCssVars?: string

    // 转换过程中出现错误的钩子
    onError?: (error: CompilerError) => void
}
```  

```ts
interface SharedTransformCodegenOptions {
    prefixIdentifiers?: boolean

    ssr?: boolean

    bindingMetadata?: BindingMetadata

    inline?: boolean

    isTS?: boolean

    filename?: string
}
```  

接下来看创建作用域对象的过程  

```ts
export function createTransformContext(
  root: RootNode,
  {
    filename = '',
    prefixIdentifiers = false,
    hoistStatic = false,
    cacheHandlers = false,
    nodeTransforms = [],
    directiveTransforms = {},
    transformHoist = null,
    isBuiltInComponent = NOOP,
    isCustomElement = NOOP,
    expressionPlugins = [],
    scopeId = null,
    ssr = false,
    ssrCssVars = ``,
    bindingMetadata = EMPTY_OBJ,
    inline = false,
    isTS = false,
    onError = defaultOnError
  }: TransformOptions
): TransformContext {
    const nameMatch = filename.replace(/\?.*$/, '').match(/([^/\\]+)\.\w+$/)
    const context: TransformContext = {
        // options
        selfName: nameMatch && capitalize(camelize(nameMatch[1])),
        prefixIdentifiers,
        hoistStatic,
        cacheHandlers,
        nodeTransforms,
        directiveTransforms,
        transformHoist,
        isBuiltInComponent,
        isCustomElement,
        expressionPlugins,
        scopeId,
        ssr,
        ssrCssVars,
        bindingMetadata,
        inline,
        isTS,
        onError,

        // state
        root,
        helpers: new Set(),
        components: new Set(),
        directives: new Set(),
        hoists: [],
        imports: new Set(),
        constantCache: new Map(),
        temps: 0,
        cached: 0,
        identifiers: Object.create(null),
        scopes: {
            vFor: 0,
            vSlot: 0,
            vPre: 0,
            vOnce: 0
        },
        parent: null,
        currentNode: root,
        childIndex: 0,

        // methods
        helper(name) {},
        helperString(name) {},
        replaceNode(node) {},
        removeNode(node) {},
        onNodeRemoved: () => {},
        addIdentifiers(exp) {},
        removeIdentifiers(exp) {},
        hoist(exp) {},
        cache(exp, isVNode = false) {}
    }

    function addId(id: string) {}

    function removeId(id: string) {}

    return context
}
```  
