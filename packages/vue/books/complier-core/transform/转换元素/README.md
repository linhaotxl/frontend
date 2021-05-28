<!-- TOC -->

- [工具函数](#工具函数)
    - [isBindKey](#isbindkey)
    - [toValidAssetId](#tovalidassetid)
- [生成器节点](#生成器节点)
- [转换元素钩子函数 —— transformElement](#转换元素钩子函数--transformelement)
    - [实际转换的函数 —— postTransformElement](#实际转换的函数--posttransformelement)
    - [buildProps](#buildprops)
        - [分析 PatchFlag —— analyzePatchFlag](#分析-patchflag--analyzepatchflag)
        - [合并去重 props](#合并去重-props)
            - [合并成为数组 —— mergeAsArray](#合并成为数组--mergeasarray)
    - [构建指令参数](#构建指令参数)
    - [格式化动态属性名集合 —— stringifyDynamicPropNames](#格式化动态属性名集合--stringifydynamicpropnames)

<!-- /TOC -->

## 工具函数  

### isBindKey  
用来检测 `v-bind` 指令的参数是否和指定的一致  

```ts
export function isBindKey(arg: DirectiveNode['arg'], name: string): boolean {
    // 参数为静态表达式，且值和指定 name 一样
    return !!(arg && isStaticExp(arg) && arg.content === name)
}
```  

### toValidAssetId  
获取资源 `id`  

```ts
export function toValidAssetId(
    name: string,                   // 资源名称
    type: 'component' | 'directive' // 资源类型，组件、指令
): string {
    return `_${type}_${name.replace(/[^\w]/g, '_')}`
}
```  

## 生成器节点  
先来看生成器节点的类型  

```ts
export interface VNodeCall extends Node {
    type: NodeTypes.VNODE_CALL                  // 节点类型
    tag: string | symbol | CallExpression       // 节点标签名，string -> 原生标签，symbol -> 内置组件，函数调用 -> 动态组件
    props: PropsExpression | undefined          // 节点 props 集合
    children:
        | TemplateChildNode[] // multiple children
        | TemplateTextChildNode // single text child
        | SlotsExpression // component slots
        | ForRenderListExpression // v-for fragment call
        | undefined
    patchFlag: string | undefined               // PatchFlag 值
    dynamicProps: string | undefined            // 动态属性名集合，是 JSON 字符串
    directives: DirectiveArguments | undefined  // 需要在运行时解析的指令集合，例如自定义指令
    isBlock: boolean                            // 是否需要开启 block
    disableTracking: boolean
}
```  

生成器的创建也很简单  

```ts
export function createVNodeCall(
  context: TransformContext | null,
  tag: VNodeCall['tag'],
  props?: VNodeCall['props'],
  children?: VNodeCall['children'],
  patchFlag?: VNodeCall['patchFlag'],
  dynamicProps?: VNodeCall['dynamicProps'],
  directives?: VNodeCall['directives'],
  isBlock: VNodeCall['isBlock'] = false,
  disableTracking: VNodeCall['disableTracking'] = false,
  loc = locStub
): VNodeCall {
    // 作用域肯定是存在的，之所以在这里要判断，是因为某些测试用例，不需要通道作用域，所以需要判断
    if (context) {
        // 如果需要开启 block，则先打开 block，再创建 block
        if (isBlock) {
            context.helper(OPEN_BLOCK)
            context.helper(CREATE_BLOCK)
        }
        // 不需要开启 block，直接创建 vnode 简单
        else {
            context.helper(CREATE_VNODE)
        }
        // 如果存在需要解析的指令，则使用 WITH_DIRECTIVES
        if (directives) {
            context.helper(WITH_DIRECTIVES)
        }
    }

    // 返回生成器节点
    return {
        type: NodeTypes.VNODE_CALL,
        tag,
        props,
        children,
        patchFlag,
        dynamicProps,
        directives,
        isBlock,
        disableTracking,
        loc
    }
}
```  

## 转换元素钩子函数 —— transformElement  
这个函数只会用来转换元素节点，包括原生节点，组件节点，但是不包括 `slot`、`template` 这两种节点  
先来看部分源码  

```ts
export const transformElement: NodeTransform = (node, context) => {
    // 排除不需要发生转换的节点
    if (
        !(
        node.type === NodeTypes.ELEMENT &&
        (node.tagType === ElementTypes.ELEMENT ||
            node.tagType === ElementTypes.COMPONENT)
        )
    ) {
        return
    }

    // 实际转换的函数，会等到所有子节点完成转换后再执行
    return function postTransformElement() { /* ... */ }
}
```  

### 实际转换的函数 —— postTransformElement  
直接来看源码  

```ts
return function postTransformElement() {
    const { tag, props } = node
    // 1. 检测是否是组件
    const isComponent = node.tagType === ElementTypes.COMPONENT

    // 2. 获取节点标签名，如果是组件则进行解析，否则就例如 '"div"' 这样
    const vnodeTag = isComponent
      ? resolveComponentType(node as ComponentNode, context)
      : `"${tag}"`
    
    // 3. 是否是动态组件，动态组件的 vnodeTag 必须是 RESOLVE_DYNAMIC_COMPONENT 函数调用节点，会通过上一步解析出来
    const isDynamicComponent =
      isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT

    let vnodeProps: VNodeCall['props']              // 节点解析好的 props 集合
    let vnodeChildren: VNodeCall['children']        // 节点子元素列表
    let vnodePatchFlag: VNodeCall['patchFlag']      // 节点解析好的 PatchFlag，是一个字符串
    let patchFlag: number = 0                       // 节点解析好的 PatchFlag，是一个数值
    let vnodeDynamicProps: VNodeCall['dynamicProps']// 节点动态属性名称列表，是 JSON 字符串
    let dynamicPropNames: string[] | undefined      // 节点动态属性名称列表，是 string 数组
    let vnodeDirectives: VNodeCall['directives']    // 节点需要在运行时解析的指令集合

    // 4. 元素外面是否需要开启 block
    //    a. 动态组件
    //    b. Teleport 组件
    //    c. Suspense 组件
    //    d. svg 标签
    //    e. foreignObject 标签
    //    f. 带有动态 key 的元素，例如 :key="id"
    let shouldUseBlock =
      isDynamicComponent ||
      vnodeTag === TELEPORT ||
      vnodeTag === SUSPENSE ||
      (!isComponent &&
        (tag === 'svg' ||
          tag === 'foreignObject' ||
          findProp(node, 'key', true)))

    // 5. 处理 props
    if (props.length > 0) {
        // 5.1 创建 props 相关内容
        const propsBuildResult = buildProps(node, context)
        // 5.2 更新解析好的 props、patchFlag、dynamicPropNames
        vnodeProps = propsBuildResult.props
        patchFlag = propsBuildResult.patchFlag
        dynamicPropNames = propsBuildResult.dynamicPropNames
        // 5.3 获取需要在运行时解析的指令集合
        const directives = propsBuildResult.directives
        // 5.4 更新运行时指令集合，对每个指令创建参数，并放入数组节点中
        vnodeDirectives =
            directives && directives.length
            ? (createArrayExpression(
                directives.map(dir => buildDirectiveArgs(dir, context))
                ) as DirectiveArguments)
            : undefined
    }

    // 6. 处理 children
    if (node.children.length > 0) {
        
    }

    // 7. 处理 PatchFlag 和动态属性名集合
    if (patchFlag !== 0) {
        // 将 PatchFlag 进行转换
        if (__DEV__) {
            if (patchFlag < 0) {
                // special flags (negative and mutually exclusive)
                vnodePatchFlag = patchFlag + ` /* ${PatchFlagNames[patchFlag]} */`
            } else {
                // bitwise flags
                const flagNames = Object.keys(PatchFlagNames)
                    .map(Number)
                    .filter(n => n > 0 && patchFlag & n)
                    .map(n => PatchFlagNames[n])
                    .join(`, `)
                vnodePatchFlag = patchFlag + ` /* ${flagNames} */`
            }
        } else {
            vnodePatchFlag = String(patchFlag)
        }
        // 将动态属性进行格式化
        if (dynamicPropNames && dynamicPropNames.length) {
            vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames)
        }
    }

    // 8. 创建生成器，并挂载到节点上
    node.codegenNode = createVNodeCall(
        context,
        vnodeTag,
        vnodeProps,         // 节点最终的 props 集合
        vnodeChildren,
        vnodePatchFlag,     // 节点最终的 PatchFlag，是一个字符串
        vnodeDynamicProps,  // 节点最终的动态属性名称集合，是一个 JSON 字符串数组
        vnodeDirectives,
        !!shouldUseBlock,
        false /* disableTracking */,
        node.loc
    )
}
```  


### buildProps  
这个函数主要用来构建节点的 `props`，并分析出 `patchFlag`、动态属性名集合等内容  


```ts
// 节点的 props 类型，可以是对象，函数调用，以及表达式节点
export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode

export function buildProps(
    node: ElementNode,                          // 节点
    context: TransformContext,                  // 作用域
    props: ElementNode['props'] = node.props,   // 节点 props
    ssr = false                                 // 是否 ssr
): {
    props: PropsExpression | undefined
    directives: DirectiveNode[]
    patchFlag: number
    dynamicPropNames: string[]
} {
    // 1. 获取标签名，定位信息
    const { tag, loc: elementLoc } = node
    // 2. 检测是否是组件
    const isComponent = node.tagType === ElementTypes.COMPONENT

    // 3. 定义解析后属性集合，包括普通静态属性(id="foo")，以及动态属性(:class="foo")
    let properties: ObjectExpression['properties'] = []
    // 4. 当需要使用 mergeProps 来合成 props 时的参数列表
    const mergeArgs: PropsExpression[] = []
    // 5. 用户自定义指令集合
    const runtimeDirectives: DirectiveNode[] = []

    let patchFlag = 0                     // 节点的 PatchFlag
    let hasRef = false                    // 是否存在 ref 属性
    let hasClassBinding = false           // 是否存在动态的 class
    let hasStyleBinding = false           // 是否存在动态的 style
    let hasHydrationEventBinding = false
    let hasDynamicKeys = false            // 是否存在动态 key
    let hasVnodeHook = false              // 是否存在 vnode 钩子函数
    const dynamicPropNames: string[] = [] // 绑定的属性名称集合

    // 分析 PatchFlag
    const analyzePatchFlag = ({ key, value }: Property) => {}

    // 6. 遍历 props
    for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        // 6.1 处理普通属性
        if (prop.type === NodeTypes.ATTRIBUTE) {
            const { loc, name, value } = prop
            // 属性默认都是静态的
            let isStatic = true

            // TODO: 处理 ref 属性
            if (name === 'ref') {
                hasRef = true
                if (!__BROWSER__ && context.inline) {
                    isStatic = false
                }
            }

            // 跳过 <component /> 上的 is 属性
            if (name === 'is' && tag === 'component') {
                continue
            }

            // 对属性名和属性值分别创建表达式节点，再创建属性节点，存入 properties 中
            properties.push(
                createObjectProperty(
                    createSimpleExpression(
                        name,
                        true,     // 属性名是静态
                        getInnerRange(loc, 0, name.length)
                    ),
                    createSimpleExpression(
                        value ? value.content : '',
                        isStatic, // 属性值的静态需要根据前面的逻辑判断
                        value ? value.loc : loc
                    )
                )
            )
        }
        // 6.2 处理指令
        else {
            const { name, arg, exp, loc } = prop
            const isBind = name === 'bind'  // 是否是 v-bind 指令
            const isOn = name === 'on'      // 是否是 v-on 指令

            // 6.2.1 跳过 v-slot 指令，由 v-slot 指令转换函数处理
            if (name === 'slot') {
                if (!isComponent) {
                    context.onError(createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, loc))
                }
                continue
            }

            // 6.2.2 跳过 v-once 指令，由 v-once 指令转换函数处理
            if (name === 'once') {
                continue
            }

            // 6.2.3 跳过 v-is 指令，或者在 component 上的 v-bind:is 指令
            if (
                name === 'is' ||
                (isBind && tag === 'component' && isBindKey(arg, 'is'))
            ) {
                continue
            }
            
            // 6.2.4 跳过 ssr 环境下的 v-on 指令
            if (isOn && ssr) {
                continue
            }

            // 6.2.5 处理没有参数的 v-bind、v-on 指令，例如 v-bind="datas"、v-on="handlers"
            if (!arg && (isBind || isOn)) {
                // 这种情况就是存在动态 key，标识开关为 true
                hasDynamicKeys = true
                // 存在指令值
                if (exp) {
                    // 如果在 v-bind、v-on 之前存在解析好的属性，首先会对它们去重合并，再生成对象，最后存入合并参数 mergeArgs 中
                    // 最后清空 properties 列表，以便在之后又出现解析好的属性
                    if (properties.length) {
                        mergeArgs.push(
                            createObjectExpression(dedupeProperties(properties), elementLoc)
                        )
                        properties = []
                    }
                    // 处理 v-bind 指令，直接将值存入合并参数 mergeArgs 中
                    if (isBind) {
                        mergeArgs.push(exp)
                    }
                    // 处理 v-on 指令，先生成 TO_HANDLERS 的函数调用，参数为值，再将 TO_HANDLERS 存入合并参数 mergeArgs 中
                    else {
                        mergeArgs.push({
                            type: NodeTypes.JS_CALL_EXPRESSION,
                            loc,
                            callee: context.helper(TO_HANDLERS),
                            arguments: [exp]
                        })
                    }
                }
                // 不存在指令值，抛错，这种情况必须存在值
                else {
                    context.onError(
                        createCompilerError(
                            isBind
                                ? ErrorCodes.X_V_BIND_NO_EXPRESSION
                                : ErrorCodes.X_V_ON_NO_EXPRESSION,
                            loc
                        )
                    )
                }
                continue
            }

            // 6.2.6 获取内置指令的转换函数，例如 v-if、v-for 是存在内置转换函数的
            const directiveTransform = context.directiveTransforms[name]
            
            // 6.2.7 存在内置指令转换函数，需要进一步处理
            if (directiveTransform) {
                // 调用转换函数，对指令进行转换
                const { props, needRuntime } = directiveTransform(prop, node, context)
                // 分析每个指令参数，来更新 PatchFlag 的值
                !ssr && props.forEach(analyzePatchFlag)
                // 将指令参数列表存入 properties
                properties.push(...props)
                // TODO: 有些内置指令(v-model)也需要在运行时解析，如果需要会将其存入 runtimeDirectives 中
                // 如果是一个 Symbol，则会将其存入 directiveImportMap 中
                if (needRuntime) {
                    runtimeDirectives.push(prop)
                    if (isSymbol(needRuntime)) {
                        directiveImportMap.set(prop, needRuntime)
                    }
                }
            }
            // 6.2.8 不存在内置指令转换函数，说明是自定义指令，放入运行时指令数组 runtimeDirectives 中
            else {
                runtimeDirectives.push(prop)    
            }
        }
    }

    // 7. 最终 props 的表达式
    let propsExpression: PropsExpression | undefined = undefined

    // 8. 处理需要合成的参数
    if (mergeArgs.length) {
        // 如果在 v-bind="datas"、v-on="handlers" 之后，又出现了解析好的属性，则和 6.2.5 处理方法一致，
        if (properties.length) {
            mergeArgs.push(
                createObjectExpression(dedupeProperties(properties), elementLoc)
            )
        }
        
        // 如果合成的参数个数大于 1，则需要用函数 MERGE_PROPS 合并
        if (mergeArgs.length > 1) {
            propsExpression = createCallExpression(
                context.helper(MERGE_PROPS),
                mergeArgs,
                elementLoc
            )
        }
        // 如果合成参数只有一个，则只需要将获取第一个即可，不需要调用 MERGE_PROPS
        else {
            propsExpression = mergeArgs[0]
        }
    }
    // 9. 没有需要合成的参数，但是有解析好的属性，和之前的处理方法一样
    else if (properties.length) {
        propsExpression = createObjectExpression(
            dedupeProperties(properties),
            elementLoc
        )
    }

    // 10. 接下来处理 PatchFlag
    // 如果存在动态 key，则直接在 patchFlag 添加 FULL_PROPS
    if (hasDynamicKeys) {
        patchFlag |= PatchFlags.FULL_PROPS
    }
    // 如果不存在动态 key，则再依次处理不同情况
    else {
        // 存在动态 class，增加 CLASS
        if (hasClassBinding) {
            patchFlag |= PatchFlags.CLASS
        }
        // 存在动态 style，增加 STYLE
        if (hasStyleBinding) {
            patchFlag |= PatchFlags.STYLE
        }
        // 存在动态属性值，增加 PROPS
        if (dynamicPropNames.length) {
            patchFlag |= PatchFlags.PROPS
        }
        // 存在服务端渲染下的事件绑定，增加 HYDRATE_EVENTS
        if (hasHydrationEventBinding) {
            patchFlag |= PatchFlags.HYDRATE_EVENTS
        }
    }

    // 11. 如果满足以下条件，还需要增加 NEED_PATCH
    //     1. patchFlag 为 0，或者只存在 HYDRATE_EVENTS
    //     2. 存在 ref 属性，或者存在 vnode 的钩子函数，或者存在运行时的钩子函数
    if (
        (patchFlag === 0 || patchFlag === PatchFlags.HYDRATE_EVENTS) &&
        (hasRef || hasVnodeHook || runtimeDirectives.length > 0)
    ) {
        patchFlag |= PatchFlags.NEED_PATCH
    }
    
    return {
        props: propsExpression,
        directives: runtimeDirectives,
        patchFlag,
        dynamicPropNames
    }
    
}
```  

#### 分析 PatchFlag —— analyzePatchFlag  
可以看到，这个函数唯一调用的入口就是经过内置指令转换函数后，对指令参数列表调用  
参数就是属性节点，其中 `key` 是指令参数节点，`value` 是指令值节点  

```ts
const analyzePatchFlag = ({ key, value }: Property) => {
    // 处理静态参数
    if (isStaticExp(key)) {
        // 获取参数名
        const name = key.content
        // 检测参数是否是事件名
        const isEventHandler = isOn(name)

        if (
            !isComponent &&
            isEventHandler &&
            // omit the flag for click handlers because hydration gives click
            // dedicated fast path.
            name.toLowerCase() !== 'onclick' &&
            // omit v-model handlers
            name !== 'onUpdate:modelValue' &&
            // omit onVnodeXXX hooks
            !isReservedProp(name)
        ) {
            hasHydrationEventBinding = true
        }

        // 如果参数是事件，并且属于内置 prop，那么它就是 vnode 的钩子函数，标记 hasVnodeHook
        if (isEventHandler && isReservedProp(name)) {
            hasVnodeHook = true
        }

        if (
            value.type === NodeTypes.JS_CACHE_EXPRESSION ||
            ((value.type === NodeTypes.SIMPLE_EXPRESSION ||
            value.type === NodeTypes.COMPOUND_EXPRESSION) &&
            getConstantType(value, context) > 0)
        ) {
            // 如果 value 是常量值，则可以直接跳过
            // skip if the prop is a cached handler or has constant value
            return
        }

        // 如果参数是 ref，即 :ref="foo"，标识开关为 true
        if (name === 'ref') {
            hasRef = true
        }
        // 如果参数是 class，即 :class=""，标识开关
        // 只有原生标签上存在动态 class 才会标记 PatchFlag 有 CLASS
        else if (name === 'class' && !isComponent) {
            hasClassBinding = true
        }
        // 如果参数是 style，即 :style=""，标识开关
        // 只有原生标签上存在动态 style 才会标记 PatchFlag 有 STYLE
        else if (name === 'style' && !isComponent) {
            hasStyleBinding = true
        }
        // 如果参数不是以上几个，而且也不是 key，那么会将其存入动态参数名集合中
        else if (name !== 'key' && !dynamicPropNames.includes(name)) {
            dynamicPropNames.push(name)
        }
    }
    // 处理动态参数，标记动态 key 开关
    else {
        hasDynamicKeys = true
    }
}
```  






#### 合并去重 props 
如果一个元素的 `props` 重复出现，那么会在 “parse” 阶段就会抛出错误，但是，对于 `class`、`style` 以及事件这三种来说，会将它们合并进数组中  

```ts
function dedupeProperties(properties: Property[]): Property[] {
    const knownProps: Map<string, Property> = new Map()
    const deduped: Property[] = []
    for (let i = 0; i < properties.length; i++) {
        const prop = properties[i]
        // dynamic keys are always allowed
        if (prop.key.type === NodeTypes.COMPOUND_EXPRESSION || !prop.key.isStatic) {
            deduped.push(prop)
            continue
        }
        const name = prop.key.content
        const existing = knownProps.get(name)
        if (existing) {
            // 只会对 style、class、事件进行合并
            if (name === 'style' || name === 'class' || name.startsWith('on')) {
                mergeAsArray(existing, prop)
            }
            // unexpected duplicate, should have emitted error during parse
        } else {
            knownProps.set(name, prop)
            deduped.push(prop)
        }
    }
    return deduped
}
```  

##### 合并成为数组 —— mergeAsArray 
将重复的属性合并为数组形式  

```ts
function mergeAsArray(
    existing: Property, // 已经存在的属性
    incoming: Property  // 需要合并的属性
) {
    // 已经为数组，直接将新值存入数组中
    if (existing.value.type === NodeTypes.JS_ARRAY_EXPRESSION) {
        existing.value.elements.push(incoming.value)
    }
    // 不是数组，将原来的属性值修改为数组，并将旧值和新值存入
    else {
        existing.value = createArrayExpression(
            [existing.value, incoming.value],
            existing.loc
        )
    }
}
```  

### 构建指令参数  
指令参数会是一个数组表达式节点，其中每个元素的意义如下  
1. 解析后指令名称  
2. 指令值节点  
3. 指令参数节点  
4. 指令修饰符节点：是一个对象节点，每个修饰符都是属性节点，`key` 是修饰符名称节点，`value` 是 `true` 节点  

```ts
function buildDirectiveArgs(
    dir: DirectiveNode,         // 指令节点
    context: TransformContext   // 作用域
): ArrayExpression {
    // 1. 指令参数集合
    const dirArgs: ArrayExpression['elements'] = []
    // 2. 是否是内置指令
    const runtime = directiveImportMap.get(dir)

    // 3. 如果是内置指令，则在运行时执行，并将执行内容存入 dirArgs 中
    if (runtime) {
        dirArgs.push(context.helperString(runtime))
    }
    // 4. 不是内置指令，就是用户自定义的指令
    else {
        const fromSetup = !__BROWSER__ && resolveSetupReference(dir.name, context)
        if (fromSetup) {
            dirArgs.push(fromSetup)
        } else {
            // 执行解析指令的操作 RESOLVE_DIRECTIVE
            context.helper(RESOLVE_DIRECTIVE)
            // 将指令名添加到作用域中
            context.directives.add(dir.name)
            // 解析指令名，并存入 dirArgs
            dirArgs.push(toValidAssetId(dir.name, `directive`))
        }
    }

    const { loc } = dir

    // 5. 如果存在指令值，则存入
    if (dir.exp) dirArgs.push(dir.exp)

    // 6. 如果存在参数，则将参数存入
    if (dir.arg) {
        // 兼容不存在指令值的情况
        if (!dir.exp) {
            dirArgs.push(`void 0`)
        }
        dirArgs.push(dir.arg)
    }

    // 7. 处理存在修饰符
    if (Object.keys(dir.modifiers).length) {
        // 兼容不存在参数或者值的情况
        if (!dir.arg) {
            if (!dir.exp) {
                dirArgs.push(`void 0`)
            }
            dirArgs.push(`void 0`)
        }
        // 创建 true 的表达式，注意这里不是静态表达式
        const trueExpression = createSimpleExpression(`true`, false, loc)
        // 为每个修饰符创建属性表达式
        // 将所有属性创建对象表达式
        // 将对象表达式存入 dirArgs
        dirArgs.push(
            createObjectExpression(
                dir.modifiers.map(modifier =>
                    createObjectProperty(modifier, trueExpression)
                ),
                loc
            )
        )
    }

    // 创建数组表达式，并返回
    return createArrayExpression(dirArgs, dir.loc)
}
```  


### 格式化动态属性名集合 —— stringifyDynamicPropNames  
将动态属性名集合格式化为 JSON 字符串，效果与 `JSON.stringify` 一致  

```ts

function stringifyDynamicPropNames(props: string[]): string {
    let propsNamesString = `[`
    for (let i = 0, l = props.length; i < l; i++) {
        propsNamesString += JSON.stringify(props[i])
        if (i < l - 1) propsNamesString += ', '
    }
    return propsNamesString + `]`
}
```  

