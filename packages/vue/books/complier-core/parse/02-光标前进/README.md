<!-- TOC -->

- [光标](#光标)
    - [移动光标](#移动光标)
    - [移动光标(返回新的光标)](#移动光标返回新的光标)
    - [获取光标](#获取光标)
- [获取定位](#获取定位)

<!-- /TOC -->

## 光标  
在上一节说过，作用域 `context` 中包含 `line`、`column` 以及 `offset` 这三个属性，在接下来的内容中会把这三个属性形象的理解为 “光标”  
“光标” 会指向 **当前需要解析的内容**，例如有以下代码  

```html
<span>hello</span>
<span>world</span>
```

接下来会以 `line-column-offset` 的形式来描述这几个值  

当还没有开始解析使，光标的内容就是初始的 `1-1-0`，指向 `<`  
当开始解析 `hello` 文本时，光标就移动到了 `1-7-6` 的位置，指向 `h`  
当解析完第一个 `span` 时，光标就移动到了 `1-19-18` 的位置，指向换行符(不要忘记换行符的存在)  

接下来就看光标是如何发生移动的  

### 移动光标  
通过工具函数 `advancePositionWithMutation` 来移动光标，它会将光标移动指定长度  

```ts
export function advancePositionWithMutation(
    pos: Position,  // 光标
    source: string, // 内容
    numberOfCharacters: number = source.length  // 前进的字符个数，默认为内容的长度
): Position {
    // 需要增加的行数，0 表示没有新增行数
    let linesCount = 0
    // 最后一个换行符的索引
    let lastNewLinePos = -1
    // 根据长度遍历内容
    // 如果内容中出现换行度，则行数 + 1
    // 并且会记录最后一个换行符出现的索引
    for (let i = 0; i < numberOfCharacters; i++) {
        if (source.charCodeAt(i) === 10) {
            linesCount++
            lastNewLinePos = i
        }
    }

    // 偏移直接加长度
    pos.offset += numberOfCharacters
    // 行数直接加新增行数
    pos.line += linesCount
    // 如果没有新增行数，则列数直接加长度
    // 如果新增了行数，则列数为最后一行的列数，即总个数 - 最后一个换行符的索引
    pos.column =
        lastNewLinePos === -1
            ? pos.column + numberOfCharacters
            : numberOfCharacters - lastNewLinePos

    return pos
}
```

通过下面的示例再详细解析下具体的过程(不要忘记换行符和制表符，其中制表符占4个字符，换行符占1个字符)  

```ts
const code = `
<div>
    hello
</div>
`.trim();

// code.length -> 22

advancePositionWithMutation({ line: 1, column: 1, offset: 0 }, code)
```

遍历结束后，存在两个换行符，所以新增了两行(`linesCount` 为 2，`lastNewLinePos` 为 `15`) 
最终的列数就是 22 - 15 = 7，得出最后一行的列数，所以最终光标的内容为 `{ line: 3, column: 7, offset: 22 }`   

### 移动光标(返回新的光标)  
通过扩展函数 `advancePositionWithClone`，它可以在不修改原始位置的情况下移动光标，返回移动后的新光标  

```ts
// extend 就是 Object.assign
export function advancePositionWithClone(
    pos: Position,
    source: string,
    numberOfCharacters: number = source.length
): Position {
    return advancePositionWithMutation(
        extend({}, pos),
        source,
        numberOfCharacters
    )
}
```  

### 获取光标  
会从中作用域中获取位置的三个属性，组成光标数据  

```ts
function getCursor(context: ParserContext): Position {
    const { column, line, offset } = context
    return { column, line, offset }
}
```

## 获取定位  
在上一节中介绍过定位信息 `SourceLocation`，接下来看如何生成定位信息  

```ts
function getSelection(
    context: ParserContext, // 作用域
    start: Position,        // 开始位置
    end?: Position          // 结束位置，默认为当前光标所在位置
): SourceLocation {
    end = end || getCursor(context)
    return {
        start, // 开始位置
        end,   // 结束位置
        source: context.originalSource.slice(start.offset, end.offset) // 开始位置和结束位置之间的内容
    }
}
```

上一节说过，为什么定位需要采用 “左闭右开”，就是为了获取 `source`  
