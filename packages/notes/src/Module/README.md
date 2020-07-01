- [值拷贝 VS 引用](#值拷贝-vs-引用)
    - [CommonJS](#commonjs)
        - [基本使用](#基本使用)
        - [通过 webpack 打包实现](#通过-webpack-打包实现)
    - [ESModule](#esmodule)
        - [基本使用](#基本使用-1)
        - [通过 webpack 打包实现](#通过-webpack-打包实现-1)

# 值拷贝 VS 引用  

## CommonJS  

### 基本使用  

CommonJS 在引用模块时，导出的是模块的浅拷贝，看下面这个示例  

```javascript
// counter.js
let num = 1;

const increase = () => {
    num = num + 1;
};

module.exports = {
    increase,
    num
};
```  

```javascript
// index.js
const { num, increase } = require( './counter' );

console.log( num ); // 1
increase();
console.log( num ); // 1
```  

1. `counter.js` 内定义的 `num` 变量会分配一块内存，在 `module.exports` 中定义的 `num` 属性会重新分配一块内存，虽然他们值相同，但是占不同的内存空间  
2. `increase` 函数只会修改 `num` 变量，而 `module.exports` 中的 `num` 属性是不会变化的  
3. 所以在 `index.js` 中两次打印的实际是 `module.exports.num`  

### 通过 webpack 打包实现   

打包后的代码如下，删除没有用的代码和注释  

```javascript
(function (modules) {
    // 模块缓存，多次加载会读缓存
    var installedModules = {};

    // require 函数实现
    function __webpack_require__(moduleId) {

        // 缓存存在直接读取缓存
        if(installedModules[moduleId]) {
            return installedModules[moduleId].exports;
        }

        // 缓存不存在，创建新的 module 并推入缓存中
        var module = installedModules[moduleId] = {
            i: moduleId,
            l: false,
            exports: {}
        };

        // 执行模块的具体逻辑
        modules[moduleId].call( module.exports, module, module.exports, __webpack_require__ );

        // 标识模块是否已经加载过
        module.l = true;

        // 返回模块的默认导出
        return module.exports;
    }

    // 加载入口模块
    return __webpack_require__( __webpack_require__.s = 0 );
})([
    /* 0 入口模块，即 webpack.config.js 里的 entry */
    (function(module, exports, __webpack_require__) {

        const { num, increase } = __webpack_require__( 1 );

        console.log( num ); // 1
        increase();
        console.log( num ); // 1

    }),
    /* 1 */
    (function(module, exports) {
        let num = 1;
        const increase = () => {
            num = num + 1;
        };
        module.exports = {
            increase,
            num
        };
    })
])
```  

1. 最外层是一个 IIFE，传入的参数是依次导入的模块，第一个为入口模块  
2. IIFE 内部，会从加载第一个模块开始执行 `__webpack_require__( __webpack_require__.s = 0 )`，直到所有的模块被加载完  

## ESModule  

### 基本使用  

ESModule 在引用模块时，导出的是模块的引用，也就是导出的是什么就是什么，不会像 CommonJS 那样，导出和定义的是两个变量，看下面的示例  

```javascript
// counter.js
export let num = 1;
export const increase = () => {
    num = num + 1;
}
```  

```javascript
// index.js
import { num, increase } from './counter';

console.log( num ); // 1
increase();
console.log( num ); // 2
```  

在 `counter.js` 中，导出的 `num` 和定义的 `num` 变量指向的是同一内存，所以执行 `increase` 函数后，`num` 的值会发生变化   

### 通过 webpack 打包实现  

```javascript
(function (modules) {
    // 模块缓存，多次加载会读缓存
    var installedModules = {};

    // require 函数实现
    function __webpack_require__(moduleId) {

        // 缓存存在直接读取缓存
        if(installedModules[moduleId]) {
            return installedModules[moduleId].exports;
        }

        // 缓存不存在，创建新的 module 并推入缓存中
        var module = installedModules[moduleId] = {
            i: moduleId,
            l: false,
            exports: {}
        };

        // 执行模块的具体逻辑
        modules[moduleId].call( module.exports, module, module.exports, __webpack_require__ );

        // 标识模块是否已经加载过
        module.l = true;

        // 返回模块的默认导出
        return module.exports;
    }

    // 定义 hasOwnProperty
    __webpack_require__.o = function(object, property) {
        return Object.prototype.hasOwnProperty.call(object, property);
    };

    // 用来设置这是一个 ESModule 标识
    __webpack_require__.r = function(exports) {
 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
 		}
 		Object.defineProperty(exports, '__esModule', { value: true });
    };
    
    // 为 exports 设置 name 属性的拦截为 getter
    __webpack_require__.d = function(exports, name, getter) {
 		if(!__webpack_require__.o(exports, name)) {
 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
 		}
 	};

    // 加载入口模块
    return __webpack_require__( __webpack_require__.s = 0 );
})([
    /* 0 入口模块 */
    (function(module, __webpack_exports__, __webpack_require__) {

        "use strict";
        // 标识这是一个 ESModule 模块
        __webpack_require__.r(__webpack_exports__);
        var _counter__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1);

        console.log( _counter__WEBPACK_IMPORTED_MODULE_0__["num"] ); // 1
        Object(_counter__WEBPACK_IMPORTED_MODULE_0__["increase"])();
        console.log( _counter__WEBPACK_IMPORTED_MODULE_0__["num"] ); // 2

    }),
    /* 1 counter.js 模块 */
    (function(module, __webpack_exports__, __webpack_require__) {

        "use strict";
        // 标识这是一个 ESModule 模块
        __webpack_require__.r(__webpack_exports__);
        // 为 __webpack_exports__ 添加 num 和 increase 拦截，实际获取到的是局部变量 num 和 increase
        __webpack_require__.d(__webpack_exports__, "num", function() { return num; });
        __webpack_require__.d(__webpack_exports__, "increase", function() { return increase; });
        
        let num = 1;
        const increase = () => {
            num = num + 1;
        }

    })
])
```  

1. 看 `counter.js` 模块（ 即第二个 ），通过 `__webpack_require__.d` 为 `exports` 对象添加了两个拦截，且拦截实际获取到的是局部变量  
2. 再通过 `increase` 修改局部变量 `num`，而在其他模块获取 `num` 的时候，会被拦截，实际获取的是局部变量 `num`，所以调用 `increase` 前后 `num` 的值会发生变化  
