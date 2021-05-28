<!-- TOC -->

- [各个节点代码生成 —— genNode](#各个节点代码生成--gennode)
    - [创建文本 —— genText](#创建文本--gentext)
    - [创建节点表达式 —— genExpression](#创建节点表达式--genexpression)
    - [创建插值表达式 —— genInterpolation](#创建插值表达式--geninterpolation)
    - [创建复合表达式 —— genCompoundExpression](#创建复合表达式--gencompoundexpression)
    - [创建注释 —— genComment](#创建注释--gencomment)
    - [创建节点 —— genVNodeCall](#创建节点--genvnodecall)
    - [创建参数 —— genNullableArgs](#创建参数--gennullableargs)
    - [创建多个节点 —— genNodeList](#创建多个节点--gennodelist)
    - [创建数组 —— genNodeListAsArray](#创建数组--gennodelistasarray)
- [创建函数调用 —— genCallExpression](#创建函数调用--gencallexpression)
- [创建对象 —— genObjectExpression](#创建对象--genobjectexpression)
    - [创建属性名 —— genExpressionAsPropertyKey](#创建属性名--genexpressionaspropertykey)
- [创建数组 —— genArrayExpression](#创建数组--genarrayexpression)
- [创建函数定义 —— genFunctionExpression](#创建函数定义--genfunctionexpression)
- [创建缓存 —— genCacheExpression](#创建缓存--gencacheexpression)
- [创建条件表达式 —— genConditionalExpression](#创建条件表达式--genconditionalexpression)

<!-- /TOC -->

在上一节中，我们知道代码生成是从根节点的生成器开始的，并调用了 [genNode](#genNode) 函数，接下来我们就先看看这个函数具体做了什么  

## 各个节点代码生成 —— genNode  
这个函数内调用根据节点的类型，来调用不同节点的生成函数，可以说是生成节点的入口函数  

```ts
function genNode(
    node: CodegenNode | symbol | string,    // 节点
    context: CodegenContext                 // 作用域
) {
    // 1. 节点为字符串，直接将字符串插入代码中
    if (isString(node)) {
        context.push(node)
        return
    }
    // 2. 节点为 Symbol(例如内置组件，tag 为 Fragment)，通过 helper 获取名称，再插入代码中
    if (isSymbol(node)) {
        context.push(context.helper(node))
        return
    }
    // 3. 根据节点类型，调用不同的函数处理
    switch (node.type) {
        // 元素节点，if 节点，for 节点，这三种类型会对生成器再次调用 genNode 来获取实际代码
        case NodeTypes.ELEMENT:
        case NodeTypes.IF:
        case NodeTypes.FOR:
            genNode(node.codegenNode!, context)
            break
        // 文本节点
        case NodeTypes.TEXT:
            genText(node, context)
            break
        // 简单表达式节点
        case NodeTypes.SIMPLE_EXPRESSION:
            genExpression(node, context)
            break
        // 插值表达式节点
        case NodeTypes.INTERPOLATION:
            genInterpolation(node, context)
            break
        // 文本生成节点
        case NodeTypes.TEXT_CALL:
            genNode(node.codegenNode, context)
            break
        // 复合节点
        case NodeTypes.COMPOUND_EXPRESSION:
            genCompoundExpression(node, context)
            break
        // 注释节点
        case NodeTypes.COMMENT:
            genComment(node, context)
            break
        // 普通生成节点
        case NodeTypes.VNODE_CALL:
            genVNodeCall(node, context)
            break

        // 函数调用节点
        case NodeTypes.JS_CALL_EXPRESSION:
            genCallExpression(node, context)
            break
        // 对象节点
        case NodeTypes.JS_OBJECT_EXPRESSION:
            genObjectExpression(node, context)
            break
        // 数组节点
        case NodeTypes.JS_ARRAY_EXPRESSION:
            genArrayExpression(node, context)
            break
        // 函数定义节点
        case NodeTypes.JS_FUNCTION_EXPRESSION:
            genFunctionExpression(node, context)
            break
        // 条件表达式节点
        case NodeTypes.JS_CONDITIONAL_EXPRESSION:
            genConditionalExpression(node, context)
            break
        // 缓存节点
        case NodeTypes.JS_CACHE_EXPRESSION:
            genCacheExpression(node, context)
            break

        // SSR only types
        case NodeTypes.JS_BLOCK_STATEMENT:
            !__BROWSER__ && genNodeList(node.body, context, true, false)
            break
        case NodeTypes.JS_TEMPLATE_LITERAL:
            !__BROWSER__ && genTemplateLiteral(node, context)
            break
        case NodeTypes.JS_IF_STATEMENT:
            !__BROWSER__ && genIfStatement(node, context)
            break
        case NodeTypes.JS_ASSIGNMENT_EXPRESSION:
            !__BROWSER__ && genAssignmentExpression(node, context)
            break
        case NodeTypes.JS_SEQUENCE_EXPRESSION:
            !__BROWSER__ && genSequenceExpression(node, context)
            break
        case NodeTypes.JS_RETURN_STATEMENT:
            !__BROWSER__ && genReturnStatement(node, context)
            break

        /* istanbul ignore next */
        case NodeTypes.IF_BRANCH:
            // noop
            break
    }
}
```  

接下来我们一个一个来看  

### 创建文本 —— genText  
处理文本很简单，只需要将文本内容转换为字符串，再添加到代码中即可  

```ts
function genText(
    node: TextNode | SimpleExpressionNode,
    context: CodegenContext
) {
    context.push(JSON.stringify(node.content), node)
}
```  

### 创建节点表达式 —— genExpression  
会根绝表达式是否是静态来决定，是需要将其转换为字符串(常量)，还是不转换(变量)  

```ts
function genExpression(node: SimpleExpressionNode, context: CodegenContext) {
    const { content, isStatic } = node
    // 如果是静态，则将表达式内容转换为字符串追加，否则直接将内容当做变量追加
    context.push(isStatic ? JSON.stringify(content) : content, node)
}
```  

### 创建插值表达式 —— genInterpolation  
每个插值的内容都会用 `toDisplayString` 包裹一层  

```ts
function genInterpolation(node: InterpolationNode, context: CodegenContext) {
    const { push, helper, pure } = context
    // 如果需要纯函数注释，则插入
    if (pure) push(PURE_ANNOTATION)
    // 插入 toDisplayString 方法
    push(`${helper(TO_DISPLAY_STRING)}(`)
    // 对插值的内容再次调用 genNode 来获取 toDisplayString 的参数
    genNode(node.content, context)
    push(`)`)
}
```  

### 创建复合表达式 —— genCompoundExpression  

```ts
function genCompoundExpression(
  node: CompoundExpressionNode,
  context: CodegenContext
) {
    // 遍历每一个子节点
    for (let i = 0; i < node.children!.length; i++) {
        const child = node.children![i]
        // 如果是字符串，直接追加到代码后
        if (isString(child)) {
            context.push(child)
        }
        // 不是字符串，重新调用 genNode 来生成代码
        else {
            genNode(child, context)
        }
    }
}
```  

### 创建注释 —— genComment  
注释只会在 `DEV` 环境下生成  

```ts
function genComment(node: CommentNode, context: CodegenContext) {
    if (__DEV__) {
        const { push, helper, pure } = context
        // 如果需要纯函数注释，则插入
        if (pure) {
            push(PURE_ANNOTATION)
        }
        // 使用 createCommentVNode 函数生成注释，参数为注释节点的字符串内容
        push(`${helper(CREATE_COMMENT)}(${JSON.stringify(node.content)})`, node)
    }
}
```  

### 创建节点 —— genVNodeCall  

```ts
function genVNodeCall(node: VNodeCall, context: CodegenContext) {
    const { push, helper, pure } = context
    const {
        tag,
        props,
        children,
        patchFlag,
        dynamicProps,
        directives,
        isBlock,
        disableTracking
    } = node

    // 1. 如果存在运行时的指令，则会插入 withDirectives 的调用
    //    withDirectives 有两个参数
    //    1）节点
    //    2）指令列表
    if (directives) {
        push(helper(WITH_DIRECTIVES) + `(`)
    }

    // 2. 如果要开启 block，则插入 openBlock 的调用
    if (isBlock) {
        push(`(${helper(OPEN_BLOCK)}(${disableTracking ? `true` : ``}), `)
    }

    // 3. 如果要插入 pure 注释，则插入
    if (pure) {
        push(PURE_ANNOTATION)
    }

    // 4. 根据是否要开启 block，插入 createBlock 还是 createVNode 方法的调用
    push(helper(isBlock ? CREATE_BLOCK : CREATE_VNODE) + `(`, node)

    // 5. 首先处理参数，分别是 tag, props, children, patchFlag, dynamicProps
    //    再调用 genNodeList 为每个参数插入正确的代码
    //    这个函数调用完，createBlock/createVNode 的参数也就插入完成了
    genNodeList(
        genNullableArgs([tag, props, children, patchFlag, dynamicProps]),
        context
    )

    // 6. 插入与 4 对应的括号
    push(`)`)

    // 7. 插入与 2 对应的括号
    if (isBlock) {
        push(`)`)
    }

    // 8. 如果存在指令，则开始插入 WITH_DIRECTIVES 的第二个参数
    //    解析指令节点
    if (directives) {
        push(`, `)
        genNode(directives, context)
        push(`)`)
    }
}
```  

### 创建参数 —— genNullableArgs  
这个函数会将参数后面的无效值去除，例如  

```ts
["'div'", undefined, undefined, 16, undefined]
// 被转换为
["'div'", "null", "null", 16]
```  
转换后的参数提供给 `createBlock` 或者 `createVNode`  

```ts
function genNullableArgs(args: any[]): CallExpression['arguments'] {
    // 从后往前遍历参数列表，如果遇到有效值，则将从头开始截取，一直到有效值，并将这个范围内的无效值替换为 null
    let i = args.length
    while (i--) {
        if (args[i] != null) break
    }
    return args.slice(0, i + 1).map(arg => arg || `null`)
}
```  

### 创建多个节点 —— genNodeList  
这个函数用来创建一系列的值，例如函数参数中  

```ts
function genNodeList(
  nodes: (string | symbol | CodegenNode | TemplateChildNode[])[],
  context: CodegenContext,      // 作用域
  multilines: boolean = false,  // 值与值之间是否需要换行
  comma: boolean = true         // 值与值之间是否需要逗号分隔
) {
    const { push, newline } = context
    // 遍历节点列表
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        // 如果节点是字符串，直接插入
        if (isString(node)) {
            push(node)
        }
        // 如果节点是数组，调用 genNodeListAsArray 处理
        else if (isArray(node)) {
            genNodeListAsArray(node, context)
        }
        // 剩余情况由 genNode 处理节点
        else {
            genNode(node, context)
        }

        // 检测是否遍历到最后一个节点，如果还没有，则根据 comma 以及 multilines 增加 , 和换行
        if (i < nodes.length - 1) {
            if (multilines) {
                comma && push(',')
                newline()
            } else {
                comma && push(', ')
            }
        }
    }
}
```  

### 创建数组 —— genNodeListAsArray  
这个函数会创建一个数组，并根据参数向数组中写入数据  

```ts
function genNodeListAsArray(
    nodes: (string | CodegenNode | TemplateChildNode[])[],
    context: CodegenContext
) {
    const multilines =
        nodes.length > 3 ||
        ((!__BROWSER__ || __DEV__) && nodes.some(n => isArray(n) || !isText(n)))
    
    // 插入数组开始符 [
    context.push(`[`)
    // 缩进换行
    multilines && context.indent()
    // 具体节点由 genNodeList 处理
    genNodeList(nodes, context, multilines)
    // 减小缩进换行
    multilines && context.deindent()
    // 插入数组结束符 ]
    context.push(`]`)
}
```  


## 创建函数调用 —— genCallExpression  

```ts
function genCallExpression(node: CallExpression, context: CodegenContext) {
    const { push, helper, pure } = context
    // 1. 获取函数名，如果不是字符串，则说明是内置模块，通过 helper 获取
    const callee = isString(node.callee) ? node.callee : helper(node.callee)
    // 2. 如果要插入 pure 注释，则插入
    if (pure) {
        push(PURE_ANNOTATION)
    }
    // 插入函数调用，例如 foo(
    push(callee + `(`, node)
    // 插入参数列表，将参数列表 arguments 传递给 genNodeList 完成
    genNodeList(node.arguments, context)
    // 插入函数调用结束
    push(`)`)
}
```  


## 创建对象 —— genObjectExpression  

```ts
function genObjectExpression(node: ObjectExpression, context: CodegenContext) {
    const { push, indent, deindent, newline } = context
    const { properties } = node
    // 1. 如果没有属性，则插入空对象
    if (!properties.length) {
        push(`{}`, node)
        return
    }
    const multilines =
        properties.length > 1 ||
        ((!__BROWSER__ || __DEV__) &&
        properties.some(p => p.value.type !== NodeTypes.SIMPLE_EXPRESSION))

    // 3. 插入对象的开始 {
    push(multilines ? `{` : `{ `)

    // 4. 缩进换行
    multilines && indent()
    // 5. 遍历属性
    for (let i = 0; i < properties.length; i++) {
        const { key, value } = properties[i]
        // 由于属性名存在多种情况，所以需要通过 genExpressionAsPropertyKey 处理
        genExpressionAsPropertyKey(key, context)
        // 插入冒号
        push(`: `)
        // 处理属性值
        genNode(value, context)
        // 如果还没有到最后一个属性，则再插入 , 并换行
        if (i < properties.length - 1) {
            push(`,`)
            newline()
        }
    }

    // 减小缩进换行
    multilines && deindent()

    // 插入结束的 }
    push(multilines ? `}` : ` }`)
}
```  

### 创建属性名 —— genExpressionAsPropertyKey  

```ts
function genExpressionAsPropertyKey(
    node: ExpressionNode,
    context: CodegenContext
) {
    const { push } = context
    // key 为计算表达式，将计算内容放在 [] 内，内容由 genCompoundExpression 生成
    if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
        push(`[`)
        genCompoundExpression(node, context)
        push(`]`)
    }
    // key 为静态内容
    else if (node.isStatic) {
        // TODO: only quote keys if necessary
        const text = isSimpleIdentifier(node.content)
            ? node.content
            : JSON.stringify(node.content)
        push(text, node)
    }
    // key 为动态内容
    else {
        push(`[${node.content}]`, node)
    }
}
```  

## 创建数组 —— genArrayExpression  

```ts
function genArrayExpression(node: ArrayExpression, context: CodegenContext) {
    // 将数组所有元素传递给 genNodeListAsArray 完成
    genNodeListAsArray(node.elements, context)
}
```  



## 创建函数定义 —— genFunctionExpression  

```ts
function genFunctionExpression(
  node: FunctionExpression,
  context: CodegenContext
) {
    const { push, indent, deindent, scopeId, mode } = context
    const { params, returns, body, newline, isSlot } = node
    // slot functions also need to push scopeId before rendering its content
    // 1. 是否需要 scopeId
    const genScopeId =
        !__BROWSER__ && isSlot && scopeId != null && mode !== 'function'

    // 2. 如果需要 scopeId，则插入调用 withId 的代码
    if (genScopeId) {
        push(`_withId(`)
    }
    // 3. 如果不需要 scopeId，但这是一个 slot 函数，则插入调用 withCtx 的代码
    else if (isSlot) {
        push(`_${helperNameMap[WITH_CTX]}(`)
    }
    
    // 4. 插入函数开始的 (
    push(`(`, node)

    // 5. 创建参数列表
    if (isArray(params)) {
        genNodeList(params, context)
    } else if (params) {
        genNode(params, context)
    }
    
    // 6. 插入参数后的函数部分
    push(`) => `)
    
    if (newline || body) {
        push(`{`)
        indent()
    }
    
    if (returns) {
        if (newline) {
            push(`return `)
        }
        if (isArray(returns)) {
            genNodeListAsArray(returns, context)
        } else {
            genNode(returns, context)
        }
    } else if (body) {
        genNode(body, context)
    }
    if (newline || body) {
        deindent()
        push(`}`)
    }
    if (genScopeId || isSlot) {
        push(`)`)
    }
}
```  

## 创建缓存 —— genCacheExpression  

```ts
function genCacheExpression(node: CacheExpression, context: CodegenContext) {
    const { push, helper, indent, deindent, newline } = context
    // 1. 根据索引，插入读取缓存的语句，例如 _cache[1] || (
    push(`_cache[${node.index}] || (`)
    // 2. 如果是节点，再插入 setBlockTracking(-1) 调用，不追踪节点
    if (node.isVNode) {
        indent()
        push(`${helper(SET_BLOCK_TRACKING)}(-1),`)
        newline()
    }

    // 3. 插入设置缓存的语句，例如 _cache[1] = 
    push(`_cache[${node.index}] = `)
    // 4. 插入值的语句，由 genNode 处理
    genNode(node.value, context)
    // 如果是节点，再插入恢复追踪的语句
    if (node.isVNode) {
        // 逗号，跟在设置缓存语句后面
        push(`,`)
        // 换行
        newline()
        // 插入 setBlockTracking(1)，恢复追踪
        push(`${helper(SET_BLOCK_TRACKING)}(1),`)
        // 换行
        newline()
        // 逗号表达式的值为最后一个，所以要再插入读取缓存值的语句 _cache[1]
        push(`_cache[${node.index}]`)
        // 减小缩进换行
        deindent()
    }
    // 插入 )
    push(`)`)
}
```  

## 创建条件表达式 —— genConditionalExpression 

```ts
function genConditionalExpression(
    node: ConditionalExpression,
    context: CodegenContext
) {
    const { test, consequent, alternate, newline: needNewline } = node
    const { push, indent, deindent, newline } = context

    // 1. 处理条件
    if (test.type === NodeTypes.SIMPLE_EXPRESSION) {
        // 条件是简单表达式，检测是否需要加 ()，并通过 genExpression 生成条件的代码
        const needsParens = !isSimpleIdentifier(test.content)
        needsParens && push(`(`)
        genExpression(test, context)
        needsParens && push(`)`)
    } else {
        // 条件不是简单表达式，则由 genNode 解析条件，并在条件两边加 ()
        push(`(`)
        genNode(test, context)
        push(`)`)
    }

    // 2. 需要换行则缩进换行
    needNewline && indent()
    // 3. 缩进级别 + 1
    context.indentLevel++
    // 4. 不需要换行则在 条件 后面加 空格
    needNewline || push(` `)
    // 5. 增加三元表达式的 ?
    push(`? `)
    // 6. 生成满足条件节点的代码
    genNode(consequent, context)
    // 7. 恢复 3 步骤缩进
    context.indentLevel--
    // 8. 需要换行则换行
    needNewline && newline()
    // 9. 不需要换行在 consequent 后加空格
    needNewline || push(` `)
    // 10. 增加三元表达式的 :
    push(`: `)
    // 11. 是否嵌套 if..else if
    const isNested = alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
    // 12. 没嵌套，缩进级别 + 1
    if (!isNested) {
        context.indentLevel++
    }
    // 13. 生成不满足条件节点的代码
    genNode(alternate, context)
    // 13. 恢复 12 步骤的缩进级别
    if (!isNested) {
        context.indentLevel--
    }
    // 14. 需要换行，则仅仅是减小缩进级别，并不换行
    needNewline && deindent(true /* without newline */)
}
```  

1. 在第 3 步中对缩进级别 + 1，为什么要这么做，考虑下面例子  

```ts
// 产生缩进
condition
  ? [
      1,    // 这里前面的缩进级别，一个由 第三步产生，一个由数组表达式产生，如果没有第三步的缩进，就会是下面那样
      2
  ]
  : [
      3,    // 同上
      4
  ]

// 不产生缩进
condition
  ? [
    1,
    2
  ]
  : [
    3,
    4  
  ]
```  
