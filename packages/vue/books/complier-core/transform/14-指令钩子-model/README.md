<!-- TOC -->

- [v-model 指令](#v-model-指令)
- [创建转换结果 —— createTransformProps](#创建转换结果--createtransformprops)
- [转换过程](#转换过程)

<!-- /TOC -->

**本篇内容主要介绍 `v-model` 指令的转换**  

## v-model 指令  

在 `3.0` 的版本中，`v-model` 指令会被转换为下面几个 `prop`  

1. 具体值，其中属性名是参数(没有参数时使用 `modelValue`)，属性值就是 `v-model` 的值
2. 修改值的事件，事件名为“ `onUpdate:` + 参数名”，将事件对象直接赋值给值  
3. 修饰符，只有组件上存在修饰符才会转换，属性名是 “参数 + `Midifiers`”，属性值是由所有修饰符组成的对象

例如存在以下代码  

```html
<Comp v-model:value.camel="name"></Comp>
```

会被转换为  

```html
<Comp
    value="name"
    v-on['onUpdate:value'] = "$event => name = $event"
    valueModifiers="{ camel: true }"
></Comp>
```

## 创建转换结果 —— createTransformProps  

这个函数仅仅用来创建指令钩子的转换结果

```ts
function createTransformProps(props: Property[] = []) {
  	return { props }
}
```

## 转换过程
接下来看源码实现  

```ts
export const transformModel: DirectiveTransform = (dir, node, context) => {
  	// 1. 获取指令值和参数
    const { exp, arg } = dir
    // 2. 指令值不存在，直接抛错，并返回空的转换结果
    if (!exp) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_MODEL_NO_EXPRESSION, dir.loc)
        )
        return createTransformProps()
    }

  	// 3. 获取指令值的原始内容
    const rawExp = exp.loc.source
    // 4. 获取指令的值的内容，简单表达式直接获取 content，复合表达式获取原始内容
    const expString = exp.type === NodeTypes.SIMPLE_EXPRESSION
        ? exp.content
        : rawExp

    // 5. im SFC <script setup> inline mode, the exp may have been transformed into
    // _unref(exp)
    const bindingType = context.bindingMetadata[rawExp]
    // 6. 
    const maybeRef =
        !__BROWSER__ &&
        context.inline &&
        bindingType &&
        bindingType !== BindingTypes.SETUP_CONST

    // 7.
    if (!isMemberExpression(expString) && !maybeRef) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION, exp.loc)
        )
        return createTransformProps()
    }

  	// 8. 如果指令值在作用域中存在引用，则抛错，并返回空的结果
  	//  	v-model 的值不允许是作用域中的值
    if (
        !__BROWSER__ &&
        context.prefixIdentifiers &&
        isSimpleIdentifier(expString) &&
        context.identifiers[expString]
    ) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE, exp.loc)
        )
        return createTransformProps()
    }

  	// 9. 获取具体值的属性名，默认是 modelValue
    const propName = arg
        ? arg
        : createSimpleExpression('modelValue', true)
        
    // 10. 获取事件名，默认是 onUpdate:modelValue
    const eventName = arg
        ? isStaticExp(arg)
            ? `onUpdate:${arg.content}`
            : createCompoundExpression(['"onUpdate:" + ', arg])
        : `onUpdate:modelValue`

    // 11. 事件函数赋值语句的节点
    let assignmentExp: ExpressionNode
    // 12. 事件参数
    const eventArg = context.isTS ? `($event: any)` : `$event`
   	// 13. TODO:
    if (maybeRef) {
        if (bindingType === BindingTypes.SETUP_REF) {
            // v-model used on known ref.
            assignmentExp = createCompoundExpression([
                `${eventArg} => (`,
                createSimpleExpression(rawExp, false, exp.loc),
                `.value = $event)`
            ])
        } else {
            // v-model used on a potentially ref binding in <script setup> inline mode.
            // the assignment needs to check whether the binding is actually a ref.
            const altAssignment = bindingType === BindingTypes.SETUP_LET
                ? `${rawExp} = $event`
                : `null`
            assignmentExp = createCompoundExpression([
                `${eventArg} => (${context.helperString(IS_REF)}(${rawExp}) ? `,
                createSimpleExpression(rawExp, false, exp.loc),
                `.value = $event : ${altAssignment})`
            ])
        }
    }
  	// 14. 创建事件的赋值节点，将参数 $event 直接赋值给指令值所指的变量
  	else {
        assignmentExp = createCompoundExpression([
            `${eventArg} => (`,
            exp,
            ` = $event)`
        ])
    }

  	// 15. 创建转换结果的 props，包括一个属性值和一个事件函数
    const props = [
        createObjectProperty(propName, dir.exp!),
        createObjectProperty(eventName, assignmentExp)
    ]

    // 16. 处理对事件函数的缓存，当指令值中没有变量的引用时才可以缓存
    if (
        !__BROWSER__ &&
        context.prefixIdentifiers &&
        context.cacheHandlers &&
        !hasScopeRef(exp, context.identifiers)
    ) {
        props[1].value = context.cache(props[1].value)
    }

  	// 17. 处理 v-model 的修饰符，修饰符只存在于组件上
    if (dir.modifiers.length && node.tagType === ElementTypes.COMPONENT) {
      	// 17.1 创建修饰符对象，是一个 string
        const modifiers = dir.modifiers
            .map(m => (isSimpleIdentifier(m) ? m : JSON.stringify(m)) + `: true`)
            .join(`, `)
        
        // 17.2 以 参数名 + Modifiers 作为修饰符的 属性名
        const modifiersKey = arg
            ? isStaticExp(arg)
                ? `${arg.content}Modifiers`
                : createCompoundExpression([arg, ' + "Modifiers"'])
            : `modelModifiers`
        // 17.3 将修饰符 prop 存入 props 集合中
        //		  其中修饰符的值是静态可提升的
        props.push(
            createObjectProperty(
                modifiersKey,
                createSimpleExpression(
                    `{ ${modifiers} }`,
                    false,
                    dir.loc,
                    ConstantTypes.CAN_HOIST
                )
            )
        )
    }

  	// 18. 返回转换结果
    return createTransformProps(props)
}
```

1. 修饰符的常量类型是 `CAN_HOIST`  

    这样不仅可以静态提升，在 [transformElement - analyzePatchFlag]() 中分析指令返回的结果中，是不会将修饰符的值存入 动态属性名 `dynamicPropNames` 的
