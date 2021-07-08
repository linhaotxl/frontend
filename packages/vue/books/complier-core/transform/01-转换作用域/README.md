<!-- TOC -->

- [什么是转换](#什么是转换)
- [转换阶段流程](#转换阶段流程)
- [作用域](#作用域)
    - [节点钩子函数](#节点钩子函数)
    - [指令钩子函数](#指令钩子函数)
    - [创建作用域](#创建作用域)
        - [帮助模块 —— helpers](#帮助模块--helpers)
        - [替换节点 —— replaceNode](#替换节点--replacenode)
        - [删除节点 —— removeNode](#删除节点--removenode)

<!-- /TOC -->

## 什么是转换
经过第一阶段的 “解析”，我们得到了 `AST` 节点，从这章开始，会进入第二步 —— 转换(Trasnform)  

转换就是操作 `AST` 节点，将它修改为我们需要的节点  
例如，我们将 `v-if` 指令，转换为了两个节点，一个是满足条件需要渲染的节点，一个是不满足条件渲染的节点(默认为注释节点)，如下  

```html
<div v-if="a">Hello World!</div>
```  

上面的 `div` 解析后会得到一个 `ElementNode`，我们会将这个节点转化为条件表达式节点，伪代码如下

```ts
// 条件表达式节点
{
    test: a,
    consequent: <div>Hello World!</div>,
    alternate: <!-- v-if -->
}
```  

## 转换阶段流程  
1. 创建 “转换” 过程的作用域对象  
2. 从根节点开始依次向下，对每一个节点依次调用 “节点钩子函数”，在对节点中每个的 `prop` 依次调用 “指令钩子函数”   

至此，遍历了所有的节点，并且完成了对每个节点的转换，得到了最终的 “生成器”  
在第三步 “生成” 中，会根据 “生成器” 来创建具体的渲染函数代码  

接下来先来看看上面提到的几个内容  

## 作用域   
“转换” 阶段也存在一个作用域对象，包含了这个阶段会用到的一些属性和方法，先来看作用域的配置对象都有哪些  

```ts
export interface TransformOptions extends SharedTransformCodegenOptions {
    /**
     * 节点转换的钩子函数集合
     */
    nodeTransforms?: NodeTransform[]

    /**
     * 指令转换钩子集合，其中 key 是指令名，value 是转换函数
     */
    directiveTransforms?: Record<string, DirectiveTransform | undefined>

    transformHoist?: HoistTransform | null

    isBuiltInComponent?: (tag: string) => symbol | void

    isCustomElement?: (tag: string) => boolean | void

    /**
     * 是否增加标识前缀，即增加数据来源
     * 例如在模板中 {{ name }}，会被转换为 {{ _ctx.name }}
     */
    prefixIdentifiers?: boolean

    /**
     * 是否需要提升静态节点
     */
    hoistStatic?: boolean

    /**
     * 是否需要缓存事件函数
     */
    cacheHandlers?: boolean

    /**
     * 通过 babel 解析模板中的语法时用到的插件
     * 例如在模板中使用可选链 a?.b，那么就需要使用 optionalChaining 插件
     */
    expressionPlugins?: ParserPlugin[]

    scopeId?: string | null

    ssrCssVars?: string

    // 转换过程中出现错误的钩子
    onError?: (error: CompilerError) => void
}
```  

以下是 “转换” 界定啊和 “生成” 节点公用的配置  

```ts
interface SharedTransformCodegenOptions {
    // 同上
    prefixIdentifiers?: boolean

    ssr?: boolean

    bindingMetadata?: BindingMetadata

    
    inline?: boolean

    /**
     * 是否是 TS 语言环境
     */
    isTS?: boolean

    filename?: string
}
```  

### 节点钩子函数  
“节点钩子函数” 作用于每个具体的节点，它可以用来修改节点的结构以及类型，先来看看它的结构  

```ts
export type NodeTransform = (
    node: RootNode | TemplateChildNode, // 需要处理的节点
    context: TransformContext           // 作用域
) => void | (() => void) | (() => void)[]
```  

它的返回值可以是函数或者函数列表，我们把这个函数称为 “退出函数”  
“退出函数” 并不会立即执行，而是会等到这个节点的所有子节点都完成转换时再去执行  

上面说到的具体的节点就是 `RootNode` 以及 `TemplateChildNode`，来看 `TemplateChildNode` 都包括哪些  

```ts
export type TemplateChildNode =
    | ElementNode               // 元素节点
    | InterpolationNode         // 插值节点
    | CompoundExpressionNode    // 复合表达式节点
    | TextNode                  // 普通文本节点
    | CommentNode               // 注释节点
    | IfNode                    // v-if 节点
    | IfBranchNode              // v-if 分支节点
    | ForNode                   // v-for 节点
    | TextCallNode              // 创建文本节点
```  

现在不清楚的节点之后会依次介绍  

### 指令钩子函数  
“指令钩子函数” 作用于每个具体的指令节点，因为指令也是属性的一种，所以这个钩子的作用就是将指令 “转换” 为属性  
作用域中的 `directiveTransforms` 形式类似于  

```ts
{
    on: transformOn,
    bind: transformBind,
    model: transformModel
}
```  

接下来就看看 “指令钩子函数” 的结构  

```ts
export type DirectiveTransform = (
    dir: DirectiveNode,           // 指令节点
    node: ElementNode,            // 存在指令的元素节点
    context: TransformContext,    // 作用域
    // 增强函数，由具体平台提供，参数是转换的指令结果
    // 例如 浏览器 下可以提供该函数，继续处理指令，增加只有浏览器才有的特性
    augmentor?: (ret: DirectiveTransformResult) => DirectiveTransformResult
) => DirectiveTransformResult
```   

返回的结果是 `DirectiveTransformResult`，看看它的结构  

```ts
export interface DirectiveTransformResult {
    props: Property[]                           // 转换好的属性集合
    needRuntime?: boolean | symbol              // 
    ssrTagParts?: TemplateLiteral['elements']
}
```  

### 创建作用域  
接下来看创建作用域对象的过程，接受两个参数  
1. 根节点  
2. 作用域配置对象  

作用域对象的结构是 `TransformContext`，它的结构直接看创建过程  

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
        prefixIdentifiers,      // 是否需要增加数据来源前缀
        hoistStatic,            // 是否需要提示静态节点
        cacheHandlers,          // 是否需要缓存事件处理函数
        nodeTransforms,         // 节点钩子函数集合
        directiveTransforms,    // 指令钩子函数集合
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
        
        currentNode: root,  // 当前正在执行勾子函数的节点
        parent: null,       // currentNode 的父节点
        childIndex: 0,      // currentNode 在 parent 中的索引

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

接下里会介绍几个通用的属性，剩下的会在具体的使用场景中介绍  

#### 帮助模块 —— helpers  
什么是帮助模块？  
例如在模板中，针对每个元素，都会通过 `createVNode` 创建一个 `vnode` 对象，或者使用了内置组件 `suspense`、`kepp-alive` 等  
而 `createVNode`、`suspense`、`keep-alive` 这些函数或变量都需要从 `vue` 模块中导入再使用  
所以，帮助模块可以理解为需要导入的函数或变量，这些模块都可以在 “runtime-core” 包里找到，接下来看看都有哪些模块函数  

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

// 模块标识 -> 模块名称，模块名称与 runtime-core 中的名称对应
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

在转换的过程中，如果需要使用这些模块，那么会通过 `helper` 函数，将模块标识存入 `helpers` 集合中  
在之后的 “生成” 阶段，会将 `helpers` 中的标识依次导入，以供渲染函数中使用  

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

`helperString` 不仅会存储模块标识，还会返回具体的模块名  

由于在 “生成” 阶段创建导入代码时，会将 `helpers` 中的模块重新命名，增加下划线 `_`，例如  
  
```ts
import { createVNode as _createVNode } from 'vue'
```  

所以在 `helperString` 中也会增加 `_`，具体使用的就是 `_createVNode` 而非 `createVNode`  

```ts
helperString(name) {
    return `_${helperNameMap[context.helper(name)]}`
}
```  

#### 替换节点 —— replaceNode  
将当前正在执行钩子函数的节点替换为指定节点，修改 `currentNode` 和 `parent.children` 中的节点  

```ts
replaceNode(node) {
    context.parent!.children[context.childIndex] = context.currentNode = node
}
```  

**Q：替换后的新节点还会执行已经执行过的钩子函数吗？**  
A：会的，源码中做了处理，对于替换后的新节点，会再次对其进行从头到尾的转换过程，具体过程在之后会看到  
其实，整个源码中只有 `v-if` 和 `v-for` 两个钩子函数会用到 `replaceNode`  

#### 删除节点 —— removeNode  
将当前正在转换的节点删除  

```ts
/**
 * 删除节点
 * @param { ElementNode | undefined } node 需要删除的节点，默认为当前正在转换的节点
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
    
    // 3. 删除当前正在转换的节点，以下两种情况均是删除当前节点
    //    a. 没有传递参数 node
    //    b. 需要删除的节点 node 就是当前正在转换的 currentNode
    if (!node || node === context.currentNode) {
        // 3.1 将当前正在转换的 node 置空，并执行删除的钩子函数
        context.currentNode = null
        context.onNodeRemoved()
    }
    // 4. 如果删除的 node 并不是当前节点，那再检测删除的 node 是在当前节点之前还是之后
    //    如果删除的 node 是当前节点之后的节点，由于后面的节点还没有处理，所以不会影响，直接删除即可
    //    如果删除的 node 是当前节点之前的节点，那么只会将 childIndex - 1，currentNode 的指向并不会改变
    else {
        if (context.childIndex > removalIndex) {
            context.childIndex--
            context.onNodeRemoved()
        }
    }
    
    // 5. 从子节点列表中删除指定节点
    context.parent!.children.splice(removalIndex, 1)
}
```  


