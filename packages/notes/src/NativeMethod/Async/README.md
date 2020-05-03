# Async  
`async` 可以将异步编程以同步的方式书写，其实它就是 `generator` 的语法糖，只不过 `generator` 函数需要手动执行，而 `async` 就是一种自动执行的 `generator`   
每个 `async` 函数的解析形式如下  

解析前  
```javascript
async function getList () {
    const result = await getListApi();
    return result;
}
```  

解析后   
```javascript
const getList = _async(function* () {
    const result = yield getListApi();
    return result;
}); 
```

可以看到这几点  
1. `async` 函数内部会被解析为 `generator` 函数，并且作为工具方法 `_async` 的参数  
2. 工具方法 `_async` 会返回一个函数
3. `async` 函数内部的 `await` 会替换为 `yield`  

解析的过程肯定是由 `babel` 完成的，所以接下来我们主要研究的就是 `_async` 方法的实现，通过这个方法可以将 `generator` 变为自动执行的  

# Async 实现  
首先声明几个函数，接下来的示例都会用到这些函数  

```javascript
const p1 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 1 );
    }, 1000)
});

const p2 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 2 );
    }, 2000)
});

const p3 = () => new Promise( resolve => {
    setTimeout(() => {
        resolve( 3 );
    }, 3000)
});

const p4 = ( time: number ) => new Promise(( _, reject ) => {
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
 
每调用一次 `next` 方法，返回的 `value` 属性都是一个 `Promise` 对象，我们将下次调用 `next` 的操作放到了上个 `Promise` 对象成功回调中，这样当上个 `Promise` 对象改变状态后，才会执行下一个 `yield` 操作  
这样就实现了自动执行 `generator` 最简单的版本  

通过 `_async` 来执行 `myGenerator` 得到如下结果  
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

继续调用 `myGenerator`，可以看到执行结果还是和上面一样  

经过上面两个示例，我们实现了自动执行 `generator` 函数，但是上面的方法都是已知状态的个数，那么对于未知状态个数的方法怎么办？  
此时就会用到 `next` 方法返回的 `done` 属性，它表示是否结束了所有的状态，继续修改 `_async` 方法，这次修改为通用的方法  

## 示例三  
```javascript
function _async ( generator ) {
    return function () {
        const gen = generator();
        const dispatch = ( val?: any ) => {
            const result = gen.next( val );

            if ( result.done ) {
                return result.value;
            }

            result.value.then( val => dispatch( val ) );
        };

        return dispatch();
    }
}
```   

在这个版本里，声明了 `dispatch` 方法，这个方法的作用就是调用 `next` 方法来改变状态，如果没有结束的话，将下一次改变状态的方法放在本次获得的 `Promise` 对象的成功回调中，依次来达到自动执行的目的