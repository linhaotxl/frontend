<!-- TOC -->

- [补充节点类型](#补充节点类型)
    - [创建简单表达式节点 —— createSimpleExpression](#创建简单表达式节点--createsimpleexpression)
    - [创建复合表达式 —— createCompoundExpression](#创建复合表达式--createcompoundexpression)
    - [表达式节点](#表达式节点)
    - [创建插值节点 —— createInterpolation](#创建插值节点--createinterpolation)
    - [创建 JS 数组节点 —— createArrayExpression](#创建-js-数组节点--createarrayexpression)
    - [创建 JS 对象属性节点 —— createObjectProperty](#创建-js-对象属性节点--createobjectproperty)
    - [创建 JS 对象节点 —— createObjectExpression](#创建-js-对象节点--createobjectexpression)
    - [创建 JS 函数调用节点 —— createCallExpression](#创建-js-函数调用节点--createcallexpression)

<!-- /TOC -->

## 补充节点类型  
在“解析”阶段，已经介绍过 `NodeTypes` 的部分类型，现在对其进行补充  

```ts
export const enum NodeTypes {
    ROOT,
    ELEMENT,
    TEXT,
    COMMENT,
    SIMPLE_EXPRESSION,
    INTERPOLATION,
    ATTRIBUTE,
    DIRECTIVE,
    
    // 容器型
    COMPOUND_EXPRESSION,        // 复合表达式
    IF,                         // v-if 节点
    IF_BRANCH,                  // v-if 的分支节点
    FOR,                        // v-for 节点
    TEXT_CALL,                  // 通过 createTextVNode 创建文本 vnode 的节点
              
    // 生成器型
    VNODE_CALL,                 // 通过 createVNode 创建 vnode 的节点
    
    // JS 中的数据类型
    JS_CALL_EXPRESSION,         // 函数调用节点
    JS_OBJECT_EXPRESSION,       // 对象节点
    JS_PROPERTY,                // 对象属性节点
    JS_ARRAY_EXPRESSION,        // 数组节点
    JS_FUNCTION_EXPRESSION,     // 函数节点
    JS_CONDITIONAL_EXPRESSION,  // 条件语句节点
    JS_CACHE_EXPRESSION,        // 缓存语句节点

    // ssr codegen
    JS_BLOCK_STATEMENT,
    JS_TEMPLATE_LITERAL,
    JS_IF_STATEMENT,
    JS_ASSIGNMENT_EXPRESSION,
    JS_SEQUENCE_EXPRESSION,
    JS_RETURN_STATEMENT
}
```  

其中部分节点类型，还会存在一个对应的创建函数，例如在 “解析” 阶段，创建根节点是通过 `createRoot` 函数创建的   
接下来就先看看各个节点的创建函数  

### 创建简单表达式节点 —— createSimpleExpression  
简单表达式表示一个简单的值，例如指令的参数，指令的值，以及插槽内容都是简单表达式，先来看它的结构  

```ts
export interface SimpleExpressionNode extends Node {
    type: NodeTypes.SIMPLE_EXPRESSION   // 类型为节点表达式
    content: string                     // 表达式的值
    isStatic: boolean                   // 值是否是静态的
    constType: ConstantTypes            // TODO: 常量类型
    // 说明表达式存在需要静态提升的节点，具体用法可以在 静态提升 章节中看到
    hoisted?: JSChildNode
    // TODO: 具体用法
    identifiers?: string[]
}
```  

创建简单表达式的函数也很简单  

```ts
export function createSimpleExpression(
    content: SimpleExpressionNode['content'],               // 表达式值
    isStatic: SimpleExpressionNode['isStatic'],             // 是否静态
    loc: SourceLocation = locStub,                          // 定位，默认为空
    constType: ConstantTypes = ConstantTypes.NOT_CONSTANT   // 常量类型
): SimpleExpressionNode {
    return {
        type: NodeTypes.SIMPLE_EXPRESSION,
        loc,
        content,
        isStatic,
        constType: isStatic ? ConstantTypes.CAN_STRINGIFY : constType
    }
}
```  

如果是静态类型，那么它的常量类型始终是 `CAN_STRINGIFY`  

### 创建复合表达式 —— createCompoundExpression  
复合表达式是将连续的文本、插值、简单表达式连接起来形成的，例如  

```html
<div>hello {{ name }}</div>
```  

`div` 的子元素在 “转换” 完成后，会变成一个节点，就是“复合表达式”，由 `hello` 和 `{{ name }}` 组成  

再来看它的结构  

```ts
export interface CompoundExpressionNode extends Node {
    type: NodeTypes.COMPOUND_EXPRESSION // 类型为复合表达式
    children: (                         // 连接起来的节点列表，可以是简单表达式、复合表达式、插值、文本节点、字符串、symbol
        | SimpleExpressionNode
        | CompoundExpressionNode
        | InterpolationNode
        | TextNode
        | string
        | symbol)[]
```  

复合表达式 也存在 `identifiers` 属性，作用和 [简单表达式](#创建简单表达式节点--createsimpleexpression) 一样  

```ts
export function createCompoundExpression(
    children: CompoundExpressionNode['children'],   // 连接列表
    loc: SourceLocation = locStub                   // 定位，默认为空
): CompoundExpressionNode {
    return {
        type: NodeTypes.COMPOUND_EXPRESSION,
        loc,
        children
    }
}
```  

### 表达式节点  
“表达式节点” 就是将 “简单” 和 “复合” 联合起来  

```ts
export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode
```  

### 创建插值节点 —— createInterpolation  
先来看插值节点的类型  

```ts
export interface InterpolationNode extends Node {
    type: NodeTypes.INTERPOLATION   // 类型为插值节点
    content: ExpressionNode         // 内容可以是简单表达式，也可以是复合表达式
}
```  

```ts
export function createInterpolation(
  content: InterpolationNode['content'] | string,   // 内容，可以是 string
  loc: SourceLocation                               // 定位
): InterpolationNode {
    // 如果内容是 string，则会创建一个动态的简单表达式
    return {
        type: NodeTypes.INTERPOLATION,
        loc,
        content: isString(content)
            ? createSimpleExpression(content, false, loc)
            : content
    }
}
```  


### 创建 JS 数组节点 —— createArrayExpression   
数组节点对应 `JS` 中的数组表达式 `[]`，先来看看数组节点的结构  

```ts
export interface ArrayExpression extends Node {
    type: NodeTypes.JS_ARRAY_EXPRESSION     // 类型为数组节点
    elements: Array<string | JSChildNode>   // 元素是 string 或者 JSChildNode 的集合
}
```  

创建数组节点的函数很简单  

```ts
export function createArrayExpression(
    elements: ArrayExpression['elements'],  // 元素列表
    loc: SourceLocation = locStub           // 定位，默认为空位置
): ArrayExpression {
    return {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        loc,
        elements
    }
}
```  


### 创建 JS 对象属性节点 —— createObjectProperty  
对象属性节点对应 `JS` 中对象里的一条属性，例如  

```ts
const obj = {
    name: 'aaa',    // 第一条对象属性
    age: 24,        // 第二条对象属性
}
```  

对象属性的结构如下  

```ts
export interface Property extends Node {
    type: NodeTypes.JS_PROPERTY // 类型为属性节点
    key: ExpressionNode         // 属性 key，只能是简单表达式，或者复合表达式(计算属性)
    value: JSChildNode          // 属性 value
}
```  

```ts
export function createObjectProperty(
    key: Property['key'] | string,  // 属性名，可以是 string
    value: Property['value']        // 属性值
): Property {
    // 如果属性名是字符串，则会将其转换为静态的简单表达式
    return {
        type: NodeTypes.JS_PROPERTY,
        loc: locStub,
        key: isString(key) ? createSimpleExpression(key, true) : key,
        value
    }
}
```  

### 创建 JS 对象节点 —— createObjectExpression  
对象节点对应 `JS` 中的对象 `{}`，它的结构如下  

```ts
export interface ObjectExpression extends Node {
    type: NodeTypes.JS_OBJECT_EXPRESSION    // 类型为对象节点
    properties: Array<Property>             // 属性列表
}
```  

```ts
export function createObjectExpression(
    properties: ObjectExpression['properties'], // 属性列表
    loc: SourceLocation = locStub               // 定位，默认为空位置
): ObjectExpression {
    return {
        type: NodeTypes.JS_OBJECT_EXPRESSION,
        loc,
        properties
    }
}
```  

### 创建 JS 函数调用节点 —— createCallExpression  
函数调用节点对应 `JS` 中的函数调用，例如 `foo()`，它的结构如下  

```ts
export interface CallExpression extends Node {
    type: NodeTypes.JS_CALL_EXPRESSION  // 类型为 JS 函数调用
    callee: string | symbol             // 函数名
    arguments: (                        // 参数列表
        | string
        | symbol
        | JSChildNode
        | SSRCodegenNode
        | TemplateChildNode
        | TemplateChildNode[])[]
}
```  

```ts
type InferCodegenNodeType<T> = T extends typeof RENDER_SLOT
    ? RenderSlotCall
    : CallExpression

export function createCallExpression<T extends CallExpression['callee']>(
    callee: T,                              // 函数名
    args: CallExpression['arguments'] = [], // 参数列表
    loc: SourceLocation = locStub
): InferCodegenNodeType<T> {
    return {
        type: NodeTypes.JS_CALL_EXPRESSION,
        loc,
        callee,
        arguments: args
    } as any
}
```  
