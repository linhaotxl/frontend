# 通用方法  
这里的方法在整个 Vue 3.0 中，会被各个模块用到，所以单独拿出来解释  

## isObject  
这个方法是用来判断是否是一个普通的对象，实现的方式也很简单，就是通过 `typeof` 来实现  

```typescript
const isObject = (val: unknown): val is Record<any, any> => val !== null && typeof val === 'object'
```  

## toRawType  
这个方法就是获取类型的字符串，就是截取 `Object.prototype.toString` 的结果