<!-- TOC -->

- [什么是转换](#什么是转换)
- [转换阶段流程](#转换阶段流程)
- [作用域](#作用域)
    - [帮助模块 —— helper](#帮助模块--helper)
    - [替换节点 —— replaceNode](#替换节点--replacenode)
    - [删除节点 —— removeNode](#删除节点--removenode)
- [转换入口 —— transform](#转换入口--transform)
    - [节点生成器](#节点生成器)
    - [补充根节点结构](#补充根节点结构)

<!-- /TOC -->

## 什么是转换
经过第一阶段的“解析”，我们得到了 `AST` 节点，从这章开始，会进入第二步 —— 转换(Trasnform)  

转换就是操作 `AST` 节点，将它修改为我们需要的节点  
例如，我们将 `v-if` 指令，转换为了两个节点，一个是满足条件需要渲染的节点，一个是不满足条件渲染的节点(默认为注释节点)，如下  

```html
<div v-if="a">Hello World!</div>
```  

上面的 `div` 会得到一个 `ElementNode`，我们会将这个节点转化为条件表达式节点，伪代码如下

```ts
// 条件表达式节点
{
    test: a,
    consequent: <div>Hello World!</div>,
    alternate: <!-- v-if -->
}
```  

## 转换阶段流程  
转换阶段最重要的就是钩子函数，钩子函数分为两种  
1. 节点钩子函数  
2. 指令钩子函数  
经过第一步 “解析” 后，获取到根节点，从顶向下依次遍历每个节点，对每个节点执行 “节点钩子函数”，对节点的每个指令执行 “指令钩子函数”，

## 作用域   
“转换” 阶段也存在一个作用域对象，包含了这个阶段会用到的一些属性和方法，先来看作用域的配置对象  

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

接下来看创建作用域对象的过程，接受两个参数  
1. 根节点  
2. 作用域配置对象  

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
        root,                   // 根节点
        helpers: new Set(),     // 帮助模块集合
        components: new Set(),  // 自定义组件集合
        directives: new Set(),  // 自定义指令集合
        hoists: [],             // 静态节点集合
        imports: new Set(),
        constantCache: new Map(),
        temps: 0,               // 临时变量个数
        cached: 0,
        identifiers: Object.create(null),
        scopes: {
            vFor: 0,
            vSlot: 0,
            vPre: 0,
            vOnce: 0
        },
        
        parent: null,       // 当前正在执行勾子函数节点 的父节点
        currentNode: root,  // 当前正在执行勾子函数的节点
        childIndex: 0,      // 当前正在执行勾子函数节点在父节点中的索引

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

### 帮助模块 —— helper  
什么是帮助模块？  
例如在模板中，针对每个元素，都会通过 `createVNode` 创建一个 `vnode` 对象，或者使用了内置组件 `suspense`、`kepp-alive` 等  
上面的 `createVNode`、`suspense`、`keep-alive` 都需要从 `vue` 模块中导入再使用  
所以，帮助模块可以理解为需要导入的函数或变量，这些模块都可以在 “`runtime-core`” 包里找到，接下来看看都有哪些模块函数  

```ts
// 模块标识，注意都是 Symbol
export const FRAGMENT = Symbol(__DEV__ ? `Fragment` : ``)
export const TELEPORT = Symbol(__DEV__ ? `Teleport` : ``)
export const SUSPENSE = Symbol(__DEV__ ? `Suspense` : ``)
export const KEEP_ALIVE = Symbol(__DEV__ ? `KeepAlive` : ``)
export const BASE_TRANSITION = Symbol(__DEV__ ? `BaseTransition` : ``)
export const OPEN_BLOCK = Symbol(__DEV__ ? `openBlock` : ``)
export const CREATE_BLOCK = Symbol(__DEV__ ? `createBlock` : ``)
export const CREATE_VNODE = Symbol(__DEV__ ? `createVNode` : ``)
export const CREATE_COMMENT = Symbol(__DEV__ ? `createCommentVNode` : ``)
export const CREATE_TEXT = Symbol(__DEV__ ? `createTextVNode` : ``)
export const CREATE_STATIC = Symbol(__DEV__ ? `createStaticVNode` : ``)
export const RESOLVE_COMPONENT = Symbol(__DEV__ ? `resolveComponent` : ``)
export const RESOLVE_DYNAMIC_COMPONENT = Symbol(__DEV__ ? `resolveDynamicComponent` : ``)
export const RESOLVE_DIRECTIVE = Symbol(__DEV__ ? `resolveDirective` : ``)
export const WITH_DIRECTIVES = Symbol(__DEV__ ? `withDirectives` : ``)
export const RENDER_LIST = Symbol(__DEV__ ? `renderList` : ``)
export const RENDER_SLOT = Symbol(__DEV__ ? `renderSlot` : ``)
export const CREATE_SLOTS = Symbol(__DEV__ ? `createSlots` : ``)
export const TO_DISPLAY_STRING = Symbol(__DEV__ ? `toDisplayString` : ``)
export const MERGE_PROPS = Symbol(__DEV__ ? `mergeProps` : ``)
export const TO_HANDLERS = Symbol(__DEV__ ? `toHandlers` : ``)
export const CAMELIZE = Symbol(__DEV__ ? `camelize` : ``)
export const CAPITALIZE = Symbol(__DEV__ ? `capitalize` : ``)
export const TO_HANDLER_KEY = Symbol(__DEV__ ? `toHandlerKey` : ``)
export const SET_BLOCK_TRACKING = Symbol(__DEV__ ? `setBlockTracking` : ``)
export const PUSH_SCOPE_ID = Symbol(__DEV__ ? `pushScopeId` : ``)
export const POP_SCOPE_ID = Symbol(__DEV__ ? `popScopeId` : ``)
export const WITH_SCOPE_ID = Symbol(__DEV__ ? `withScopeId` : ``)
export const WITH_CTX = Symbol(__DEV__ ? `withCtx` : ``)
export const UNREF = Symbol(__DEV__ ? `unref` : ``)
export const IS_REF = Symbol(__DEV__ ? `isRef` : ``)

// 模块标识 -> 模块名称，与 runtime-core 中的名称对应
export const helperNameMap: any = {
    [FRAGMENT]: `Fragment`,
    [TELEPORT]: `Teleport`,
    [SUSPENSE]: `Suspense`,
    [KEEP_ALIVE]: `KeepAlive`,
    [BASE_TRANSITION]: `BaseTransition`,
    [OPEN_BLOCK]: `openBlock`,
    [CREATE_BLOCK]: `createBlock`,
    [CREATE_VNODE]: `createVNode`,
    [CREATE_COMMENT]: `createCommentVNode`,
    [CREATE_TEXT]: `createTextVNode`,
    [CREATE_STATIC]: `createStaticVNode`,
    [RESOLVE_COMPONENT]: `resolveComponent`,
    [RESOLVE_DYNAMIC_COMPONENT]: `resolveDynamicComponent`,
    [RESOLVE_DIRECTIVE]: `resolveDirective`,
    [WITH_DIRECTIVES]: `withDirectives`,
    [RENDER_LIST]: `renderList`,
    [RENDER_SLOT]: `renderSlot`,
    [CREATE_SLOTS]: `createSlots`,
    [TO_DISPLAY_STRING]: `toDisplayString`,
    [MERGE_PROPS]: `mergeProps`,
    [TO_HANDLERS]: `toHandlers`,
    [CAMELIZE]: `camelize`,
    [CAPITALIZE]: `capitalize`,
    [TO_HANDLER_KEY]: `toHandlerKey`,
    [SET_BLOCK_TRACKING]: `setBlockTracking`,
    [PUSH_SCOPE_ID]: `pushScopeId`,
    [POP_SCOPE_ID]: `popScopeId`,
    [WITH_SCOPE_ID]: `withScopeId`,
    [WITH_CTX]: `withCtx`,
    [UNREF]: `unref`,
    [IS_REF]: `isRef`
}
```  

在转换的过程中，如果需要使用这些模块，那么会通过 `context.helper` 函数，将模块标识存入 `context.helpers` 集合中  
在之后的 “生成” 阶段，会将 `helpers` 中的标识，依据 `helperNameMap`，导入正确的模块名，以供使用  

```ts
/**
 * 存储模块标识，并返回模块标识
 * @param { symbol } name 帮助模块标识
 */
helper(name) {
    context.helpers.add(name)
    return name
}
```  

`helperString` 不仅会存储模块标识，还会返回具体使用的模块名  
注意在返回的模块名前加了 `_`，是因为在 “生成” 阶段中，会将 `helpers` 中的模块重新命名，例如  

```ts
import { createVNode as _createVNode } from 'vue'
```  


```ts
helperString(name) {
    return `_${helperNameMap[context.helper(name)]}`
}
```  

### 替换节点 —— replaceNode  
将当前正在执行钩子函数的节点替换为新的节点，修改 `currentNode` 和 `parent.children` 中的节点  

```ts
replaceNode(node) {
    context.parent!.children[context.childIndex] = context.currentNode = node
}
```  

### 删除节点 —— removeNode  

```ts
/**
 * 删除节点
 * @param { ElementNode | undefined } node 需要删除的节点，不指定默认为当前节点
 */
removeNode(node) {
    // 1. 获取当前父节点的所有子节点
    const list = context.parent!.children
    // 2. 如果 node 存在，获取 node 在子节点中的索引
    //    如果 node 不存在，获取 currentNode 在子节点中的索引，也就是 childIndex
    const removalIndex = node
        ? list.indexOf(node)
        : context.currentNode
            ? context.childIndex
            : -1
    
    // 3. 如果 node 不存在，获取 node 存在，且和 currentNode 是同一个节点，则删除当前的 currentNode
    if (!node || node === context.currentNode) {
        context.currentNode = null
        context.onNodeRemoved()
    }
    // 4. 能进入 else 的唯一入口就是，删除的 node 并不是 currentNode
    //    如果删除的是当前节点之后的节点，由于后面的节点还没有处理，所以不会影响，什么也不会做
    //    如果删除的是当前节点之前的节点，那么会将 childIndex - 1，currentNode 的指向并不会改变
    else {
        if (context.childIndex > removalIndex) {
            context.childIndex--
            context.onNodeRemoved()
        }
    }
    
    // 5. 从 parent.children 删除指定节点
    context.parent!.children.splice(removalIndex, 1)
}
```  



## 转换入口 —— transform  

```ts
export function transform(root: RootNode, options: TransformOptions) {
    // 1. 创建作用域对象
    const context = createTransformContext(root, options)
    // 2. 从根节点开始遍历执行所有钩子函数
    traverseNode(root, context)

    // 3. 
    if (options.hoistStatic) {
        hoistStatic(root, context)
    }
    // 4. 
    if (!options.ssr) {
        createRootCodegen(root, context)
    }
    // 5. 将作用域中的部分内容挂载在根节点上
    root.helpers = [...context.helpers]         // 帮助模块集合
    root.components = [...context.components]   // 自定义组件集合
    root.directives = [...context.directives]   // 自定义指令集合
    root.imports = [...context.imports]         //
    root.hoists = context.hoists                // 静态节点集合
    root.temps = context.temps                  // 临时变量个数
    root.cached = context.cached                // 
}
```  

### 节点生成器

### 补充根节点结构  
