<!-- TOC -->

- [转换元素](#转换元素)
    - [解析组件类型 —— resolveComponentType](#解析组件类型--resolvecomponenttype)
    - [处理 props](#处理-props)
        - [buildProps](#buildprops)
            - [分析 PatchFlag —— analyzePatchFlag](#分析-patchflag--analyzepatchflag)
        - [处理指令](#处理指令)
            - [buildDirectiveArgs](#builddirectiveargs)
    - [处理 children](#处理-children)
    - [处理 PatchFlag 和动态属性](#处理-patchflag-和动态属性)
    - [解析都动态属性集合 —— stringifyDynamicPropNames](#解析都动态属性集合--stringifydynamicpropnames)
    - [创建 vnode 调用节点](#创建-vnode-调用节点)

<!-- /TOC -->

## 转换元素  
转换元素主要针对普通元素和组件，而 `slot`、`template` 是不会处理的，会由其他钩子处理  
转换的结果就是要创建 “生成器”，在 生成 阶段会根据 “生成器” 节点来生成渲染函数代码  

接下来先来看看转换的大致流程   

```ts
export const transformElement: NodeTransform = (node, context) => {
    // 1. 只会处理普通元素和组件
    if (
        !(
        node.type === NodeTypes.ELEMENT &&
        (node.tagType === ElementTypes.ELEMENT ||
            node.tagType === ElementTypes.COMPONENT)
        )
    ) {
        return
    }
    
    // 2. 会等到所有子节点转换完成再处理
    return function postTransformElement() {
        const { tag, props } = node
        // 2.1 检测是否是组件
        const isComponent = node.tagType === ElementTypes.COMPONENT

        // 2.2 获取标签名，如果是组件则会解析，否则会获取标签名的字符串形式，例如 "div"  
        //     这个值会在生成阶段被用在 createVNode 的第一个参数，所以需要加 ""
        const vnodeTag = isComponent
            ? resolveComponentType(node as ComponentNode, context)
            : `"${tag}"`

        // 2.3 检测是否是动态组件，上一步解析结果如果是 RESOLVE_DYNAMIC_COMPONENT 的函数调用则说明是动态组件
        const isDynamicComponent = isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT

        // 2.4 声明一些与节点相关的变量
        let vnodeProps: VNodeCall['props']                  // 节点最终的 props 集合
        let vnodeChildren: VNodeCall['children']            // 节点最终的 children
        let vnodePatchFlag: VNodeCall['patchFlag']          // 节点的 PatchFlag，是一个 string
        let patchFlag: number = 0                           // 节点的 PatchFlag，是一个 number
        let vnodeDynamicProps: VNodeCall['dynamicProps']    // 节点动态 props 集合
        let dynamicPropNames: string[] | undefined          // 节点动态 props 名称集合
        let vnodeDirectives: VNodeCall['directives']				// 节点上的自定义指令集合

        // 2.5 是否需要开启 block，以下情况都需要
        //     a. 动态组件
        //     b. Teleport 组件
        //     c. Suspense 组件
        //     d. svg 标签
        //     e. foreignObject 标签
        //     f. 存在 key 属性的节点
        let shouldUseBlock =
            isDynamicComponent ||
            vnodeTag === TELEPORT ||
            vnodeTag === SUSPENSE ||
            (!isComponent &&
                (tag === 'svg' ||
                tag === 'foreignObject' ||
                findProp(node, 'key', true)))

        // 2.6 处理 props
        if (props.length > 0) {
            /* ... */
        }

        // 2.7 处理 children
        if (node.children.length > 0) {
            /* ... */
        }

        // 2.8 处理 patchFlag 和 动态属性
        if (patchFlag !== 0) {
            /* ... */
        }

        // 2.9 创建生成器
        node.codegenNode = createVNodeCall(
            context,
            vnodeTag,
            vnodeProps,
            vnodeChildren,
            vnodePatchFlag,
            vnodeDynamicProps,
            vnodeDirectives,
            !!shouldUseBlock,
            false /* disableTracking */,
            node.loc
        )
    }
}
```

接下来一个一个来看具体的过程  

### 解析组件类型 —— resolveComponentType  

```ts
export function resolveComponentType(
    node: ComponentNode,        // 组件节点
    context: TransformContext,  // 作用域
    ssr = false                 // 是否 ssr
) {
    const { tag } = node

    // 1. 检查是否是动态组件，如果是 component 标签，则查找 is 属性，否则查找 v-is 指令
    const isProp = node.tag === 'component'
        ? findProp(node, 'is')
        : findDir(node, 'is')
        
    // 2. 处理是动态组件的情况
    if (isProp) {
        // 2.1 获取动态组件的名称
        //     如果是 component 上存在 is 属性，由于 is 的值在解析的时候会生成文本，这里会将其转化为简单表达式节点
        //     指令值本身就是简单表达式，所以不会处理
        const exp = isProp.type === NodeTypes.ATTRIBUTE
            ? isProp.value && createSimpleExpression(isProp.value.content, true)
            : isProp.exp
        // 2.2 动态组件会返回 RESOLVE_DYNAMIC_COMPONENT 的函数调用
        //     如果不存在值，那么会被当做为一个普通的组件
        if (exp) {
            return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
                exp
            ])
        }
    }

    // 2. 处理是内置组件的情况，将其存入帮助模块，并返回对应的标识
    const builtIn = isCoreComponent(tag) || context.isBuiltInComponent(tag)
    if (builtIn) {
        if (!ssr) context.helper(builtIn)
        return builtIn
    }

    // 3.
    if (!__BROWSER__) {
        /* ... */
    }

    // 4.
    if (!__BROWSER__ && context.selfName) {
        /* ... */
    }

    // 5. 剩下的都是自定义组件的情况
    //    加入解析组件的帮助模块
    context.helper(RESOLVE_COMPONENT)
    // 向作用域中添加组件名称
    context.components.add(tag)
    // 将组件名转换为有效的名称
    return toValidAssetId(tag, `component`)
}
```


### 处理 props  
先来看看 [转换元素](#转换元素) 中是如何处理 `props` 的(2.6)，主要通过 [buildProps]() 来创建，之后进行赋值操作

接下来先来看这个函数的返回值都有哪些  

```ts
export function buildProps(
    node: ElementNode,                          // 元素节点
    context: TransformContext,                  // 作用域
    props: ElementNode['props'] = node.props,   // 元素节点上的 props
    ssr = false
): {
    props: PropsExpression | undefined  // 最终形成的 props 表达式
    directives: DirectiveNode[]         // 需要在运行时执行的指令，包括自定义指令和一些特殊的内置指令
    patchFlag: number                   // 最终形成的 PatchFlag
    dynamicPropNames: string[]          // 动态属性名集合
} { /* ... */}
```

其中返回 `props` 是 `props` 表达式类型 —— `PropsExpression` ，结构如下 

```ts
export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode
```

总共有三种类型，来看看每种类型是怎么出现的  

1. `ObjectExpression`：当所有 `props` 都是静态属性时，会为每一个属性创建 `Property`，最后放入对象节点中  

    ```html
    <div id="root" class="app"></div>
    ```

2. `CallExpression`：当存在 `v-bind="data"` 或者 `v-on="handlers"` 这种时，如果还同时存在其他属性或指令，就会通过 `mergeProps` 函数来将它们合并  

    ```html
    <div v-bind="obj" class="app"></div>
    ```

3. `ExpressionNode`：仅存在 `v-bind="data"` 或者 `v-on="handlers"` 时，会直接将它们的值作为结果，不再需要合并，所以是 `ExpressionNode`  

    ```html
    <div v-bind="obj"></div>
    ```

接下来看创建后是如何赋值的

```ts
// 1. 创建最终 props 相关的内容
const propsBuildResult = buildProps(node, context)
// 2. 赋值 vnodeProps
vnodeProps = propsBuildResult.props
// 3. 赋值 patchFlag 以及 dynamicPropNames，这两个会在 2.8 中进一步处理
patchFlag = propsBuildResult.patchFlag
dynamicPropNames = propsBuildResult.dynamicPropNames
// 4. 处理指令
const directives = propsBuildResult.directives
vnodeDirectives = directives && directives.length
    ? (createArrayExpression(
        directives.map(dir => buildDirectiveArgs(dir, context))
    ) as DirectiveArguments)
    : undefined
```

接下来先看 `buildProps` 函数都做了什么  

#### buildProps  
```ts
export function buildProps(
    node: ElementNode,
    context: TransformContext,
    props: ElementNode['props'] = node.props,
    ssr = false
): {
    props: PropsExpression | undefined
    directives: DirectiveNode[]
    patchFlag: number
    dynamicPropNames: string[]
} {
    const { tag, loc: elementLoc } = node
    // 1. 定义一些用到的变量
    // 是否是组价
    const isComponent = node.tagType === ElementTypes.COMPONENT
    // 存储解析好的属性集合，包括静态属性和指令
    let properties: ObjectExpression['properties'] = []
    // 需要合并的参数列表
    const mergeArgs: PropsExpression[] = []
    // 需要在运行时执行的指令，包括自定义指令、几个特殊的内置指令
    const runtimeDirectives: DirectiveNode[] = []

    let patchFlag = 0                       // patchFlag 的值
    let hasRef = false                      // 是否存在 ref
    let hasClassBinding = false             // 是否存在动态的 class
    let hasStyleBinding = false             // 是否存在动态的 style
    let hasHydrationEventBinding = false    // 
    let hasDynamicKeys = false              // 是否存在动态的 key
    let hasVnodeHook = false                // 是否存在 vnode 的生命周期函数(和组件的生命周期类似，每个 vnode 也存在生命周期函数)
    const dynamicPropNames: string[] = []   // 动态属性名集合

    // 2. 分析 patchFlag 的函数，这个函数放在后面说
    const analyzePatchFlag = ({ key, value }: Property) => {
        /* ... */
    }

    // 3. 遍历所有 props
    for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        // 3.1 处理静态属性
        if (prop.type === NodeTypes.ATTRIBUTE) {
            const { loc, name, value } = prop
            // 3.1.1 静态属性默认都是静态的，只有在 inline 模式下，ref 的值是动态的
            let isStatic = true
            if (name === 'ref') {
                hasRef = true
                if (!__BROWSER__ && context.inline) {
                    isStatic = false
                }
            }
            // 3.1.2 跳过 component 中的 is 属性，不作处理
            if (name === 'is' && tag === 'component') {
                continue
            }
            // 3.1.3 对属性名和属性值创建简单表达式，并作为对象属性存入 properties 中
            properties.push(
                createObjectProperty(
                    // 属性名是静态的
                    createSimpleExpression(
                        name,
                        true,
                        getInnerRange(loc, 0, name.length)
                    ),
                    // 属性值根据前面的判断决定是静态还是动态
                    createSimpleExpression(
                        value ? value.content : '',
                        isStatic,
                        value ? value.loc : loc
                    )
                )
            )
        }
        // 3.2 处理指令
        else {
            // 3.2.1 获取指令名、参数、值，以及是否是 v-bind 指令、是否是 v-on 指令
            const { name, arg, exp, loc } = prop
            const isBind = name === 'bind'
            const isOn = name === 'on'  
            // 3.2.2 跳过 v-slot 指令，不作处理，v-slot 会有单独的钩子处理
            // 			 如果 v-slot 指令出现在非组件上，会抛错
            if (name === 'slot') {
                if (!isComponent) {
                    context.onError(
                        createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, loc)
                    )
                }
                continue
            }
            // 3.2.3 跳过 v-once 指令，不作处理，由单独的钩子处理
            if (name === 'once') {
                continue
            }
            // 3.2.4 跳过 v-is 指令，或者 component 标签上出现 :is 也会跳过，不作处理
            if (
                name === 'is' ||
                (isBind && tag === 'component' && isBindKey(arg, 'is'))
            ) {
                continue
            }
            // 3.2.5 ssr 环境下跳过 v-on 指令
            if (isOn && ssr) {
                continue
            }
            // 3.2.6 处理出现 v-bind="obj" 或者 v-on="handlers" 的情况，以下称这两种类型为动态指令
            if (!arg && (isBind || isOn)) {
                // 标记出现了动态 key
                hasDynamicKeys = true
                if (exp) {
                    // 如果在动态指令之前，出现了其他静态属性或指令，则会将这些属性和指令去重并存入对象节点中，再将这个对象存入参数 mergeArgs 中
                    // 之后清空 properties，以便在动态指令之后再出现属性或指令
                    if (properties.length) {
                        mergeArgs.push(
                            createObjectExpression(dedupeProperties(properties), elementLoc)
                        )
                        properties = []
                    }
                    // 如果是 v-bind 指令，直接将值存入参数 mergeArgs 中
                    if (isBind) {
                        mergeArgs.push(exp)
                    }
                    // 如果是 v-on 指令，会将值经过 toHandlers 的转换，再存入参数 mergeArgs 中
                    // 也就是说，v-on 的值会先经过 toHandlers 转换，再进行合并，例如 v-on="obj" -> toHandlers(obj)
                    else {
                        mergeArgs.push({
                            type: NodeTypes.JS_CALL_EXPRESSION,
                            loc,
                            callee: context.helper(TO_HANDLERS),
                            arguments: [exp]
                        })
                    }
                }
                // 如果值不存在，则直接抛错，不再解析这个指令
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
            // 3.2.7 获取转换指令的钩子，如果存在钩子则调用它，否则说明是自定义的指令，存入 runtimeDirectives 中
            const directiveTransform = context.directiveTransforms[name]
            if (directiveTransform) {
                // 3.2.7.1 调用指令钩子，获取指令解析后的 属性 以及 是否需要在运行时再次解析
                const { props, needRuntime } = directiveTransform(prop, node, context)
                // 3.2.7.2 对指令产生的每一个属性进行 analyzePatchFlag 分析，之后存入 properties 中
                !ssr && props.forEach(analyzePatchFlag)
                properties.push(...props)
              	// 3.2.7.3 needRuntime 表示是否需要在运行时解析指令
              	//				 如果需要则会将其存入 runtimeDirectives 中，和自定义指令在运行时解析
              	//   			 如果 needRuntime 是 symbol，则说明这同时还是一个内置指令，表示具体的指令名
              	//			   会将其存入 directiveImportMap 中，之后会取出指令名，通过 helperString 导入名称模块
                if (needRuntime) {
                    runtimeDirectives.push(prop)
                    if (isSymbol(needRuntime)) {
                        directiveImportMap.set(prop, needRuntime)
                    }
                }
            } else {
                runtimeDirectives.push(prop)
            }
        }
    }

    // 4. 定义最终 props 的变量
    let propsExpression: PropsExpression | undefined = undefined
    
    // 5. 检查是否存在需要合成的 props
    if (mergeArgs.length) {
        // 5.1 如果在 v-bind="obj" 或者 v-on="handlers" 之后又出现了静态属性或者指令
      	//     则和上面的处理方式一样，去重、合称为对象存入参数 mergeArgs 中
        if (properties.length) {
            mergeArgs.push(
                createObjectExpression(dedupeProperties(properties), elementLoc)
            )
        }
        // 5.2 如果参数个数大于 1，则最终的 props 就是 mergeProps 的调用
        if (mergeArgs.length > 1) {
            propsExpression = createCallExpression(
                context.helper(MERGE_PROPS),
                mergeArgs,
                elementLoc
            )
        }
        // 5.3 否则只会取第一个为最终结果，不需要合并
        else {
            propsExpression = mergeArgs[0]
        }
    }
    // 6. 如果没有需要合并的 props，但是存在静态属性或指令，则和上面处理方法一样，将合成好的对象最为最终值
    else if (properties.length) {
        propsExpression = createObjectExpression(
            dedupeProperties(properties),
            elementLoc
        )
    }

    // 7. 设置 PatchFlag
    //    如果存在动态属性名，则增加 FULL_PROP
    //    如果不存在，则依次检查是否出现了 动态 class、动态 style、动态属性值，依次增加对应的标识
    if (hasDynamicKeys) {
        patchFlag |= PatchFlags.FULL_PROPS
    } else {
        if (hasClassBinding) {
            patchFlag |= PatchFlags.CLASS
        }
        if (hasStyleBinding) {
            patchFlag |= PatchFlags.STYLE
        }
        if (dynamicPropNames.length) {
            patchFlag |= PatchFlags.PROPS
        }
        if (hasHydrationEventBinding) {
            patchFlag |= PatchFlags.HYDRATE_EVENTS
        }
    }

    // 8. 增加 NEED_PATCH 的情况
  	// 		当不存在任何动态属性，或者仅仅存在 HYDRATE_EVENTS 时，出现以下情况会增加 NEED_PATCH
 		// 		a. 存在 ref 属性
  	//		b. 存在 vnode 的钩子函数
  	// 		c. 存在运行时解析的指令
    if (
        (patchFlag === 0 || patchFlag === PatchFlags.HYDRATE_EVENTS) &&
        (hasRef || hasVnodeHook || runtimeDirectives.length > 0)
    ) {
        patchFlag |= PatchFlags.NEED_PATCH
    }

    // 9. 返回结果
    return {
        props: propsExpression,
        directives: runtimeDirectives,
        patchFlag,
        dynamicPropNames
    }
}
```

2. 在 3.2.7.3 中出现了一个 `directiveImportMap` 变量，它的定义如下  

    ```ts
    const directiveImportMap = new WeakMap<DirectiveNode, symbol>()
    ```
    其中 `key` 是指令节点，`value` 是内置指令的 `symbol` 标识，例如 `v-model` 指令的 `symbol`(在 `runtime-dom` 中可以找到)
    它的作用就是解析内置指令导入的模块名称，详细内容可以参考 [构建指令](#buildDirectiveArgs)  
3. 对于 `v-bind="data"` 以及 `v-on="handlers"` 这两种指令来说，在 3.2.6 中处理完就 `continue` 了，并不会执行具体的指令钩子  

##### 分析 PatchFlag —— analyzePatchFlag  
这个函数只有在调用完指令钩子后，对指令产生的每一个属性调用  

```ts
/**
 * @param { key }   指令属性名
 * @param { value } 指令属性值
 */
const analyzePatchFlag = ({ key, value }: Property) => {
    // 1. 检测属性名是否是静态的
    if (isStaticExp(key)) {
        // 1.1 获取属性名以及是否是事件函数
        const name = key.content
        const isEventHandler = isOn(name)
        // 1.2 TODO:
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

      	// 1.3 如果是事件函数，并且是内置属性，则说明是 vnode 的钩子函数，标记 hasVnodeHook
        if (isEventHandler && isReservedProp(name)) {
            hasVnodeHook = true
        }

      	// 1.4 如果值是缓存表达式，或者属于常量，则不再进行任何操作
        if (
            value.type === NodeTypes.JS_CACHE_EXPRESSION ||
            ((value.type === NodeTypes.SIMPLE_EXPRESSION ||
                value.type === NodeTypes.COMPOUND_EXPRESSION) &&
                getConstantType(value, context) > 0)
        ) {
            // TODO: skip if the prop is a cached handler or has constant value
            return
        }
        // 1.5 存在 ref，标记 hasRef
        if (name === 'ref') {
            hasRef = true
        }
        // 1.6 在普通元素上存在动态 class，标记 hasClassBinding
        else if (name === 'class' && !isComponent) {
            hasClassBinding = true
        }
        // 1.7 在普通元素上存在动态 style，标记 hasStyleBindinghasStyleBinding
        else if (name === 'style' && !isComponent) {
            hasStyleBinding = true
        }
        // 1.8 剩下的属性都会被标记为动态属性，存入 dynamicPropNames，除了 key
        else if (name !== 'key' && !dynamicPropNames.includes(name)) {
            dynamicPropNames.push(name)
        }
    }
    // 2. 如果属性名是动态的，则标记 hasDynamicKeys，存在动态 key
    else {
        hasDynamicKeys = true
    }
}
```

#### 处理指令  
在 [buildProps](#buildProps) 的结果中，获取到运行时需要解析的指令后，会进一步处理，对每一个指令调用 `buildDirectiveArgs` 生成参数节点列表  
最终赋值给 `vnodeDirectives`，在生成节点中会使用  

```ts
const directives = propsBuildResult.directives
vnodeDirectives = directives && directives.length
    ? (createArrayExpression(
        directives.map(dir => buildDirectiveArgs(dir, context))
    ) as DirectiveArguments)
    : undefined
```

接下来看看处理后的指令类型 `DirectiveArguments` 结构  

```ts
// 指令参数列表
export interface DirectiveArguments extends ArrayExpression {
    elements: DirectiveArgumentNode[]
}

// 指令参数节点，也是一个数组结构，其中每个元素依次为 指令名、指令值、指令参数、修饰符
export interface DirectiveArgumentNode extends ArrayExpression {
    elements:
        | [string]
        | [string, ExpressionNode]
        | [string, ExpressionNode, ExpressionNode]
        | [string, ExpressionNode, ExpressionNode, ObjectExpression]
}
```

之所以要生成这样的类型，是因为运行时指令最终会由 `runtime-core` 中的 `withDirectives` 执行，而这个函数的参数依次就是 指令名、指令值、指令参数以及修饰符  	

##### buildDirectiveArgs  

这个函数是用来生成参数节点，接下来看具体实现  

```ts
function buildDirectiveArgs(
  dir: DirectiveNode,           // 指令节点
  context: TransformContext     // 作用域
): ArrayExpression {
    // 1. 存储参数节点的集合
    const dirArgs: ArrayExpression['elements'] = []
    // 2. 获取内置指令标识
    const runtime = directiveImportMap.get(dir)
    // 3. 检测是否是内置指令，如果是内置指令，导入帮助模块函数，并将模块名作为指令名存入
    if (runtime) {
        dirArgs.push(context.helperString(runtime))
    }
    // 4. 不是内置指令，也就是用户自定义指令
    else {
        // 4.1 
        const fromSetup = !__BROWSER__ && resolveSetupReference(dir.name, context)
        if (fromSetup) {
            dirArgs.push(fromSetup)
        }
      	// 4.2 注入解析自定义指令的函数 resolveDirective，并将指令名存入在作用域中
      	//		 再将解析后的指令名存入
      	else {
            // 4.2 注入解析自定义指令的函数 resolveDirective，并将指令名存入在作用域中
            context.helper(RESOLVE_DIRECTIVE)
            context.directives.add(dir.name)
            dirArgs.push(toValidAssetId(dir.name, `directive`))
        }
    }
    
    const { loc } = dir
    // 5. 存入指令值
    if (dir.exp) dirArgs.push(dir.exp)
    // 6. 存入指令参数，兼容没有指令值的情况
    if (dir.arg) {
        if (!dir.exp) {
            dirArgs.push(`void 0`)
        }
        dirArgs.push(dir.arg)
    }
    // 7. 存入修饰符
    if (Object.keys(dir.modifiers).length) {
        // 7.1 兼容没有值和参数的情况
        if (!dir.arg) {
            if (!dir.exp) {
                dirArgs.push(`void 0`)
            }
            dirArgs.push(`void 0`)
        }
        // 7.2 创建 true 的表达式
        const trueExpression = createSimpleExpression(`true`, false, loc)
        // 7.3 为每个修饰符都会创建对象属性，key 为修饰符名，value 为 true，最后将所有修饰符属性存入对象中
        //     再将对象存入 dirArgs 中
        dirArgs.push(
            createObjectExpression(
                dir.modifiers.map(modifier =>
                    createObjectProperty(modifier, trueExpression)
                ),
                loc
            )
        )
    }
    // 8. 返回数组节点，元素就是上面说的四个元素
    return createArrayExpression(dirArgs, dir.loc)
}
```

注意：  
1. 为什么 7.2 中创建 `true` 的表达式是动态的？  
是因为在生成代码的过程中，如果表达式是静态的，那么会将值进行 `JSON.stringify`，使得两边存在 引号，如果这样，在生成的代码中，就是一个字符串了  
而修饰符的值是一个布尔值，不是字符串，所以这里设置为动态的，避免字符串化，这样，在生成的代码中，就是 `true` 而非 `"true"` 了  
2. 存在以下代码，着重看 `_directive_foo` 的部分  

    ```html
    <div v-foo:click.extra="bar"></div>
    ```
    以上代码生成的渲染函数为  

    ```ts
    // 解析自定义指令
    const _directive_foo = _resolveDirective("foo");
    // 接下来生成 vnode 节点会用到 _directive_foo 变量
    _withDirectives((_openBlock(), _createBlock("div", null, null, 512 /* NEED_PATCH */)), [
        [
            _directive_foo,
            _ctx.bar,
            "click",
            { extra: true }
        ]
    ])
    ```

### 处理 children  
处理 `children` 在 2.7 中，且存在 `children` 才会处理  

```ts
// 2.7 处理 children
if (node.children.length > 0) {
    // 2.7.1 keep-alive 组件强制开启 block，并增加动态 slots 的 patchFlag —— DYNAMIC_SLOTS 
    if (vnodeTag === KEEP_ALIVE) {
        shouldUseBlock = true
        patchFlag |= PatchFlags.DYNAMIC_SLOTS
    }

    // 2.7.2 检测子节点是否作为组件的插槽，节点必须是组件，且不是 teleport 或者 keep-alive
  	//			 因为他们两个实际并不是组件，他们的子节点会由他们自己处理
    const shouldBuildAsSlots =
        isComponent &&
        vnodeTag !== TELEPORT &&
        vnodeTag !== KEEP_ALIVE

    // 2.7.3 处理插槽
    if (shouldBuildAsSlots) {
      	// 2.7.3.1 创建插槽的子节点
        const { slots, hasDynamicSlots } = buildSlots(node, context)
        // 2.7.3.2 将插槽内容作为子节点
        vnodeChildren = slots
      	// 2.7.3.3 若存在动态 slots，则增加 patchFlag 标记
        if (hasDynamicSlots) {
            patchFlag |= PatchFlags.DYNAMIC_SLOTS
        }
    }
    // 2.7.4 处理只有一个子节点，且不是 teleport 的情况
    else if (node.children.length === 1 && vnodeTag !== TELEPORT) {
        // 2.7.4.1 获取唯一的子节点，以及子节点的类型
        const child = node.children[0]
        const type = child.type
        // 2.7.4.2 检测是否含有动态文本，子节点为插值或者组合表达式被认为是动态文本
        const hasDynamicTextChild =
            type === NodeTypes.INTERPOLATION ||
            type === NodeTypes.COMPOUND_EXPRESSION
        // 2.7.4.3 如果存在动态文本，且不是常量，则需要增加 PatchFlags.TEXT
        if (
            hasDynamicTextChild &&
            getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
        ) {
            patchFlag |= PatchFlags.TEXT
        }
        // 2.7.4.4 如果唯一的子节点是文本型节点(文本、插值、复合)，则直接将文本型节点作为 children
        //         例如 <div>{{ name }}</div>
        if (hasDynamicTextChild || type === NodeTypes.TEXT) {
            vnodeChildren = child as TemplateTextChildNode
        }
        // 2.7.4.5 否则还是会将原本所有的子节点作为 children
        //         例如 <div><span></span></div>
        else {
            vnodeChildren = node.children
        }
    }
    // 2.7.5 剩余情况都将所有子节点作为 children，包括
    //       存在多个 children
    //       teleport 是唯一子节点
    else {
        vnodeChildren = node.children
    }
}
```

### 处理 PatchFlag 和动态属性名  
先来看处理过程  

```ts
// 2.8 处理 patchFlag 以及 dynamicPropNames
if (patchFlag !== 0) {
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
    if (dynamicPropNames && dynamicPropNames.length) {
        vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames)
    }
}
```

处理 `PatchFlag` 很简单，只是将其转换为字符串，接下来看动态属性的处理  

### 解析动态属性集合 —— stringifyDynamicPropNames  
这个函数很简单，主要是将动态属性名数组进行 `JSON` 序列化，和 `JSON.stringify` 类似  

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

### 创建 vnode 调用节点  
这个函数用来创建调用 `createVNode` 函数的节点，最终会被挂载在节点的 `codegenNode` 属性上，直接来看源码  

```ts
function createVNodeCall(
    context: TransformContext | null,           // 作用域
    tag: VNodeCall['tag'],                      // 节点并标签名，对应前面的 vnodeTag
    props?: VNodeCall['props'],                 // 节点 props 集合，对应前面的 vnodeProps
    children?: VNodeCall['children'],           // 节点 children，对应前面的 vnodeChildren
    patchFlag?: VNodeCall['patchFlag'],         // 节点 patchFlag，对应前面的 vnodePatchFlag
    dynamicProps?: VNodeCall['dynamicProps'],   // 节点动态属性集合，对应前面的 vnodeDynamicProps
    directives?: VNodeCall['directives'],       // 节点需要解析指令集合，对应前面的 vnodeDirectives
    isBlock: VNodeCall['isBlock'] = false,      // 是否需要开启新的 block
    disableTracking: VNodeCall['disableTracking'] = false,  // 开启的 block 是否需要追踪，对应 createBlock 的第二个参数
    loc = locStub                               // 定位信息
): VNodeCall {
    if (context) {
        // 如果需要开启 block，则导入模块 openBlock 和 createBlock
        if (isBlock) {
            context.helper(OPEN_BLOCK)
            context.helper(CREATE_BLOCK)
        }
        // 如果不开启 block，只需要导入模块 createVNode
        else {
            context.helper(CREATE_VNODE)
        }
        // 如果存在解析的指令，导入模块 withDirectives
        if (directives) {
            context.helper(WITH_DIRECTIVES)
        }
    }

    // 返回 vnode 调用节点
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