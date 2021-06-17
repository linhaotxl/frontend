<!-- TOC -->

- [钩子函数 —— transformOn](#钩子函数--transformon)

<!-- /TOC -->

**这篇内容主要介绍 `v-on` 指令的钩子函数**  

## 钩子函数 —— transformOn  
源码中重写了 `v-on` 的指令节点，先来看看  

```ts
export interface VOnDirectiveNode extends DirectiveNode {
    // 指令参数改写为表达式节点，不再会有不存在的青情况，不存在的情况 v-on="handlers" 已经在 transformElements 钩子中处理过了
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
        // 4.1 处理静态参数，处理步骤为：驼峰化 -> 首字母大写 -> 前面加 on -> 创建静态简单表达式
        //     例如 v-on:foo-bar -> onFooBar
        if (arg.isStatic) {
            const rawName = arg.content
            eventName = createSimpleExpression(
                toHandlerKey(camelize(rawName)),
                true,
                arg.loc
            )
        }
        // 4.2 处理动态参数，创建复合表达式，将参数用 toHandlerKey 包裹，形成事件名
        else {
            // #2388
            eventName = createCompoundExpression([
                `${context.helperString(TO_HANDLER_KEY)}(`,
                arg,
                `)`
            ])
        }
    }
    // 5. 处理参数是复合表达式，例如 <div v-on:[event(foo)]="handler"/> 这种情况，会在 transformExpression 中先转换为复合表达式
    //    此时只需要将所有内容用 toHandlerKey 包裹
    else {
        eventName = arg
        eventName.children.unshift(`${context.helperString(TO_HANDLER_KEY)}(`)
        eventName.children.push(`)`)
    }

    // 6. 获取 v-on 的值，如果值无效，将其置为 undefined
    let exp: ExpressionNode | undefined = dir.exp as
        | SimpleExpressionNode
        | undefined
    if (exp && !exp.content.trim()) {
        exp = undefined
    }

    // 7. 检测是否需要缓存处理函数，初始只有开启缓存开关，并且值不存在时才会
    //    后面还会根据具体的情况修改这个变量
    let shouldCache: boolean = context.cacheHandlers && !exp

    // 8. 处理存在有效值的情况(包括增加前缀，包裹事件函数)
    if (exp) {
        // 8.1 检测值是否是成员调用，例如 @click="handleClick"、@click="a.b"、@click="a['b']"
        const isMemberExp = isMemberExpression(exp.content)
        // 8.2 检测是否是内联语句(不是成员调用且满足函数表达式才属于)
        const isInlineStatement = !(isMemberExp || fnExpRE.test(exp.content))
        // 8.3 检测是否存在多个语句，例如 v-on:click="foo();bar()"
        const hasMultipleStatements = exp.content.includes(`;`)
        // 8.4 对值增加前缀
        if (!__BROWSER__ && context.prefixIdentifiers) {
            // 8.4.1 将 $event 添加到 identifiers 列表中，不需要为 $event 增加前缀
            isInlineStatement && context.addIdentifiers(`$event`)
            // 8.4.2 对值进行添加前缀操作
            exp = dir.exp = processExpression(
                exp,
                context,
                false,
                hasMultipleStatements
            )
            // 8.4.3 添加完成，移除 $event
            isInlineStatement && context.removeIdentifiers(`$event`)
            // 8.4.5 TODO: 检测是否需要缓存事件函数
            shouldCache =
                context.cacheHandlers &&
                !(exp.type === NodeTypes.SIMPLE_EXPRESSION && exp.constType > 0) &&
                !(isMemberExp && node.tagType === ElementTypes.COMPONENT) &&
                !hasScopeRef(exp, context.identifiers)
            // 8.4.6 现在修改值的内容为函数调用，例如 handlers && handlers(...args)，这里修改的内容最终会被包进函数内(在第 9 步中)
            //       只会在缓存开关 shouldCache 为 true，并且是成员调用的情况下进行
            //       @click="foo" -> (...args) => (_ctx.foo && _ctx.foo(...args))
            //       @click="foo.bar" -> (...args) => (_ctx.foo.bar && _ctx.foo.bar(...args))
            if (shouldCache && isMemberExp) {
                if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
                    exp.content = `${exp.content} && ${exp.content}(...args)`
                } else {
                    exp.children = [...exp.children, ` && `, ...exp.children, `(...args)`]
                }
            }
        }

        // 8.5 将原本的值包装进新的函数内，注意如果存在多行，那么最终的事件函数是没有返回值的
        //     只会对内联语句，或者 8.4.6 中能缓存的值进行包装
        //     @click="foo($event)" -> $event => (_ctx.foo($event))
        //     @click="i++" -> $event => (_ctx.i++)
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

    // 9. 生成指令钩子返回结果，如果值不存在，会使用空的函数体作为值
    let ret: DirectiveTransformResult = {
        props: [
            createObjectProperty(
                eventName,
                exp || createSimpleExpression(`() => {}`, false, loc)
            )
        ]
    }

    // 10. 如果存在 v-on 的额外处理，则将此时的结果作为参数调用，并将调用结果重写
    //     在不同平台下可能会进行额外处理，例如 complier-dom 里的 v-on
    if (augmentor) {
        ret = augmentor(ret)
    }

    // 11. 如果需要缓存，则会将事件函数进行缓存，转换为缓存节点
    if (shouldCache) {
        ret.props[0].value = context.cache(ret.props[0].value)
    }

    return ret
}
```  
