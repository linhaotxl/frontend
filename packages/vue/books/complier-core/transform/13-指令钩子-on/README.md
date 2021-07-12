<!-- TOC -->

- [钩子函数 —— transformOn](#钩子函数--transformon)

<!-- /TOC -->

**这篇内容主要介绍 `v-on` 指令的钩子函数**  

## 钩子函数 —— transformOn  
源码中重写了 `v-on` 的指令节点，先来看看  

```ts
export interface VOnDirectiveNode extends DirectiveNode {
    // 参数改写为表达式节点，不再会有不存在的情况
  	// 因为没有参数的情况 v-on="handlers" 已经在 transformElements 钩子中处理过了
    arg: ExpressionNode
    // 指令值改写为简单表达式，不再会有复合表达式的情况，因为在这个时候，指令值还没有做任何处理，所以只能是简单表达式
    // 而指令参数在 transformExpression 钩子中已经处理过，所以可能为复合表达式
    exp: SimpleExpressionNode | undefined
}
```

接下来看源码  

```ts
export const transformOn: DirectiveTransform = (
    dir,
    node,
    context,
    augmentor
) => {
    // 1. 获取指令参数，修饰符
    const { loc, modifiers, arg } = dir as VOnDirectiveNode
    // 2. 如果既不存在指令值，也不存在修饰符，则抛错
    if (!dir.exp && !modifiers.length) {
        context.onError(createCompilerError(ErrorCodes.X_V_ON_NO_EXPRESSION, loc))
    }
    // 3. 定义事件名的表达式节点
    let eventName: ExpressionNode
    // 4. 处理参数是简单表达式
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
        // 4.1 处理静态参数，会创建事件名的节点，例如 <div @click="" />
      	// 		 创建步骤为：驼峰化(camelize) -> 转换为事件 key(toHandlerKey)，其中包括 首字母大写 以及 前面加 on
        //     例如 v-on:foo-bar -> onFooBar
        if (arg.isStatic) {
            const rawName = arg.content
            eventName = createSimpleExpression(
                toHandlerKey(camelize(rawName)),
                true,
                arg.loc
            )
        }
        // 4.2 处理动态参数，例如 <div @[eventName] />
      	//		 创建复合表达式，将参数用 toHandlerKey 包裹，形成事件 key
        else {
            eventName = createCompoundExpression([
                `${context.helperString(TO_HANDLER_KEY)}(`,
                arg,
                `)`
            ])
        }
    }
    // 5. 处理参数是复合表达式，例如 <div v-on:[event.name]="handler"/> 这种情况
    //    此时只需要将所有内容用 toHandlerKey 包裹，形成事件 key
    else {
        eventName = arg
        eventName.children.unshift(`${context.helperString(TO_HANDLER_KEY)}(`)
        eventName.children.push(`)`)
    }

    // 6. 定义指令值变量，初始化指令值节点
    let exp: ExpressionNode | undefined = dir.exp as
        | SimpleExpressionNode
        | undefined
   	// 7. 如果值无效，将其置为 undefined
    if (exp && !exp.content.trim()) {
        exp = undefined
    }

    // 8. 定义检测是否需要缓存事件函数
    //    在没有事件函数的情况下会使用空函数代替，所以初始值是在没有值的情况下会缓存
  	//	 	后面会根据具体情况再更新
    let shouldCache: boolean = context.cacheHandlers && !exp

    // 9. 处理存在有效值的情况(包括增加前缀，包裹事件函数)
    if (exp) {
        // 9.1 检测值是否是成员调用，例如 @click="handleClick"、@click="a.b"、@click="a['b']" 都属于
      	//		 下面称这种调用方法是 成员调用
        const isMemberExp = isMemberExpression(exp.content)
        // 9.2 检测是否是内联语句(不是成员调用也不是函数表达式才属于内联函数)
        const isInlineStatement = !(isMemberExp || fnExpRE.test(exp.content))
        // 9.3 检测是否存在多个语句，例如 v-on:click="foo();bar()"
        const hasMultipleStatements = exp.content.includes(`;`)
        // 9.4 对值增加前缀
        if (!__BROWSER__ && context.prefixIdentifiers) {
            // 9.4.1 行内语句会将 $event 添加到 identifiers 列表中，在解析事件函数时不再为 $event 增加前缀
            isInlineStatement && context.addIdentifiers(`$event`)
            // 9.4.2 对值进行添加前缀操作
            exp = dir.exp = processExpression(
                exp,
                context,
                false,
                hasMultipleStatements
            )
            // 9.4.3 解析完成，移除 $event
            isInlineStatement && context.removeIdentifiers(`$event`)
            // 9.4.4 TODO: 检测是否需要缓存事件函数
            shouldCache =
              	// 开启缓存开关
                context.cacheHandlers &&
              	// 值不能是常量类型
                !(exp.type === NodeTypes.SIMPLE_EXPRESSION && exp.constType > 0) &&
              	// 如果是传递给组件的成员调用函数，则不会缓存
                !(isMemberExp && node.tagType === ElementTypes.COMPONENT) &&
                !hasScopeRef(exp, context.identifiers)

          	// 9.4.5 兼容成员调用不存在的情况，修改事件函数，加入判断
          	//  		 会把事件函数包在一个函数内部，这个函数会在 9.5 中加入，参数 args 也是这个函数提供的
          	//       @click="foo" -> foo && foo(...args)
          	//   		 @click="foo.bar" -> foo.bar && foo.bar(...args)
            if (shouldCache && isMemberExp) {
                if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
                    exp.content = `${exp.content} && ${exp.content}(...args)`
                } else {
                    exp.children = [...exp.children, ` && `, ...exp.children, `(...args)`]
                }
            }
        }

        // 9.5 封装事件处理函数
        //     只会对内联语句，或者 9.4.5 中能缓存的事件进行包封装
      	//		 注意，如果存在多个语句，那么事件函数是没有返回值的
        //     @click="foo($event)" -> $event => (_ctx.foo($event))
        //     @click="i++" -> $event => (_ctx.i++)
      	//  	 @click="handler" -> (...args) => _ctx.handler && _ctx.handler(...args)
        if (isInlineStatement || (shouldCache && isMemberExp)) {
            exp = createCompoundExpression([
                `${
                isInlineStatement
                    // 内联语句会携带参数 $event
                    ? !__BROWSER__ && context.isTS
                        ? `($event: any)`
                        : `$event`
                    // 非内联语句的参数就是 ...args
                    : `${
                        !__BROWSER__ && context.isTS ? `\n//@ts-ignore\n` : ``
                    }(...args)`
                } => ${hasMultipleStatements ? `{` : `(`}`,
                exp,
                hasMultipleStatements ? `}` : `)`
            ])
        }
    }

    // 10. 生成指令钩子返回结果，如果值不存在，会使用空的函数体作为值
    let ret: DirectiveTransformResult = {
        props: [
            createObjectProperty(
                eventName,
                exp || createSimpleExpression(`() => {}`, false, loc)
            )
        ]
    }

    // 11. 如果存在 v-on 的额外处理，则将此时的结果作为参数调用，并将调用结果重写
    //     在不同平台下可能会进行额外处理，例如 complier-dom 里的 v-on
    if (augmentor) {
        ret = augmentor(ret)
    }

    // 12. 如果需要缓存，则会将事件函数进行缓存，转换为缓存节点
    if (shouldCache) {
        ret.props[0].value = context.cache(ret.props[0].value)
    }

    return ret
}
```