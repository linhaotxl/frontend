import { p1, p2, p3, p4 } from './test';

function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    try {
        yield p4( 1000 );
    } catch ( e ) {
        console.log( '捕获到的错误是 -> ', e );
    }
    console.log( 'third value -> '  + (yield p3()) );
    return 0;
}

function _async ( generator: () => Generator<Promise<any>> ) {
    return function () {
        // 模拟 async 返回一个 Promise 对象
        return new Promise(( resolve, reject ) => {
            const gen = generator();
            const dispatch = ( val?: any ) => {
                const result = gen.next( val );

                // 只有当执行结束后，才会将返回的 Promise 状态改为成功
                if ( result.done ) {
                    return resolve( result.value );
                }

                Promise.resolve( result.value )
                .then( dispatch )
                // .catch( err => {
                //     gen.throw( err );
                // })
            };

            return dispatch();
        });
    }
}

function getListApi () {
    return new Promise(( resolve, reject ) => {
        setTimeout(() => {
            reject([ 'Nicholas', 'IconMan' ]);
        }, 3000);
    });
}

function* getList () {
    let users;

    try {
        users = yield getListApi();
    } catch ( e ) {
        console.log( 111, e );
        users = [];
    }

    console.log( 'users -> ', users );
}

export default function start () {
    _async( getList )()
}