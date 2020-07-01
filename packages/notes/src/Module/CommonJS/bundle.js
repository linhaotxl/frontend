(() => {
    let __webpack_modules__ = [
        ,
        module => {
            let num = 1;
            const increase = function () {
                num = num + 1;
            }

            module.exports = {
                num,
                increase
            };
        }
    ];

    let __webpack_module_cache__ = {};

    // 导入模块函数
    function __webpack_require__ ( moduleId ) {
        // 读取缓存
        if ( __webpack_module_cache__[ moduleId ] ) {
            return __webpack_module_cache__[ moduleId ].exports;
        }

        // 不存在缓存，新创建模块
        var module = (__webpack_module_cache__[ moduleId ] = {
            exports: {}
        });

        // 执行模块
        __webpack_modules__[ moduleId ]( module, module.exports, __webpack_require__ );

        // 返回获取模块的结果
        return module.exports;
    }

    (() => {
        const { num, increase } = __webpack_require__(1);

        console.log( num );
        increase();
        console.log( num );
    })()

})()