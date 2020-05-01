# Async  
`async` 可以将异步编程以同步的方式书写，其实它就是 `generator` 的语法糖，只不过 `generator` 函数需要手动执行，而 `async` 就是一种自动执行的 `generator`   
`async` 函数的解析形式如下  

```javascript
async function getList () {
    const result = await getListApi();
    return result;
}

const getList = _async(function* () {
    const result = yield getListApi();
    return result;
});  
```  

可以看到这几点  
1. `async` 函数会被解析为 `generator` 函数，并且作为工具方法 `_async` 的参数  
2. 工具方法 `_async` 会返回一个函数
3. `async` 函数内部的 `await` 会替换为 `yield`

# Async 实现  
接下来我们一步一步实现 `async` 函数，首先声明几个函数，接下来的示例都会基于这些函数实现  

```javascript
export const p1 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 1 );
    }, 1000)
});

export const p2 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 2 );
    }, 2000)
});

export const p3 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 3 );
    }, 3000)
});

export const p4 = ( time: number ) => new Promise(( _, reject ) => {
    setTimeout(() => {
        reject( 'p4 失败' );
    }, time);
});
```  

## 示例一  
声明一个 `_async` 函数，接受一个 `generator` 函数作为参数  

```javascript  
function* myGenerator () {
    yield p1();
    yield p2();
    yield p3();
    return 0;
}

function _async ( generator ) {
    return function () {
        const gen = generator();

        gen.next().value.then( value1 => {
            console.log( 'first value -> ', value1 );
            gen.next().value.then( value2 => {
                console.log( 'second value -> ', value2 );
                gen.next().value.then( value3 => {
                    console.log( 'third value -> ', value3 );
                    console.log( 'return value -> ', gen.next().value );
                });
            });
        });
    }
}
```  

现在，调用这个函数，并传入参数 `myGenerator` 会得到如下的结果  
```javascript
// 1s 后
// first value ->  1
// 2s 后
// second value ->  2
// 3s 后
// third value ->  3
// return value -> 0
```  

我们知道 `generator` 函数里的 `yield` 默认是没有返回值的，但是如果在调用 `next` 方法时传递了一个参数，那么这个参数就是上一个 `yield` 的返回值，所以第一次调用 `next` 方法传递的参数是没有用的  
我们利用这点，将上面的示例进行改造  

## 示例二  

```javascript
function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    console.log( 'third value -> '  + (yield p3()) );
    return 0;
}
```  

改造 `_async` 函数如下  

```javascript
function _async ( generator ) {
    return function () {
        const gen = generator();

        gen.next().value.then( value1 => {
            gen.next( value1 ).value.then( value2 => {
                gen.next( value2 ).value.then( value3 => {
                    console.log( 'return value -> ' + gen.next( value3 ).value );
                });
            });
        });
    }
}
```  

继续调用 `_async( myGenerator )`，可以看到执行结果还是和上面一样  

经过上面两个示例，我们实现了自动执行 `generator` 函数，但是上面的方法都是已知状态的个数，那么对于未知状态个数的方法怎么办？  
此时就会用到 `next` 方法返回的 `done` 属性，它表示是否结束了所有的状态，继续修改 `_async` 方法，这次修改为通用的方法  

## 示例三  
```javascript
function _async ( generator ) {
    return function () {
        const gen = generator();
        const next = ( val?: any ) => {
            const result = gen.next( val );

            if ( result.done ) {
                return result.value;
            }

            result.value.then( val => next( val ) );
        };

        return next();
    }
}
```  