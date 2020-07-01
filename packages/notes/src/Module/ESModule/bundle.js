(() => {
    let __webpack_modules__ = [
        ,
        ( module, exports, require ) => {
            require.d( exports, {
                num: () => num,
                increase: () => increase
            });

            let num = 1;
            const increase = () => {
                num = num + 1;
            }
        }
    ];

    let __webpack_module_cache__  = {};

    function __webpack_require__ ( moduleId ) {
        if ( __webpack_module_cache__[ moduleId ] ) {
            return __webpack_module_cache__[ moduleId ].exports;
        }

        var module = (__webpack_module_cache__[ moduleId ] = {
            exports: {}
        });

        __webpack_modules__[ moduleId ]( module, module.exports, __webpack_require__ );

        return module.exports;
    }

    (() => {
        __webpack_require__.o = ( obj, prop ) => {
            return Object.prototype.hasOwnProperty.call( obj, prop );  
        }
    })();

    (() => {
        __webpack_require__.d = ( exports, definition ) => {
            for ( let key in definition ) {
                if ( __webpack_require__.o( definition, key ) && !__webpack_require__.o( exports, key ) ) {
                    Object.defineProperty( exports, key, {
                        enumerable: true,
                        get: definition[ key ]
                    });
                }
            }
        }
    })();

    (() => {
        var _counter__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__( 1 );

        console.log( _counter__WEBPACK_IMPORTED_MODULE_0__.num );
        _counter__WEBPACK_IMPORTED_MODULE_0__.increase();
        console.log( _counter__WEBPACK_IMPORTED_MODULE_0__.num );
    })()
})()