<!-- TOC -->

- [v-bind 指令钩子](#v-bind-指令钩子)

<!-- /TOC -->

## v-bind 指令钩子  

这个钩子主要处理 `v-bind` 指令的内容，不是很复杂，直接看源码

```ts
export const transformBind: DirectiveTransform = (dir, node, context) => {
    // 1. 获取指令值，参数，修饰符
    const { exp, modifiers, loc } = dir
    const arg = dir.arg!

    // 2. 处理参数是复合表达式的情况
    //		v-bind 的参数会在 transformExpression 钩子中处理，如果是复合表达式，只有一种情况，就是参数是动态的
    //    会在参数两边加 () 并兼容参数不存在的情况，参数不存在时使用 ""
    if (arg.type !== NodeTypes.SIMPLE_EXPRESSION) {
        arg.children.unshift(`(`)
        arg.children.push(`) || ""`)
    }
  	// 3. 处理参数是简单表达式且是动态的，会兼容参数不存在的情况，不存在时使用 ""
  	else if (!arg.isStatic) {
        arg.content = `${arg.content} || ""`
    }

  	// 4. 处理 camel 修饰符
    if (modifiers.includes('camel')) {
      	// 4.1 参数是简单表达式
      	// 		 参数是静态的，直接将参数名驼峰化
      	//		 参数是动态的，将参数名作为 camelize 的参数，进行转换
        if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
          	if (arg.isStatic) {
              	arg.content = camelize(arg.content)
          	} else {
              	arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`
          	}
        }
      	// 4.2 参数是复合表达式，将所有子节点作为 camelize 的参数进行转换
      	else {
          	arg.children.unshift(`${context.helperString(CAMELIZE)}(`)
          	arg.children.push(`)`)
        }
    }

  	// 5. 处理指令值无效的情况，抛出错误，返回空值的属性集合
    if (
        !exp ||
        (exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim())
    ) {
        context.onError(createCompilerError(ErrorCodes.X_V_BIND_NO_EXPRESSION, loc))
        return {
            props: [createObjectProperty(arg!, createSimpleExpression('', true, loc))]
        }
    }

  	// 6. 返回由参数和值组成的属性集合
    return {
        props: [createObjectProperty(arg!, exp)]
    }
}
```