import { p1, p2, p3 } from './test';

function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    console.log( 'third value -> '  + (yield p3()) );
    return 0;
}

function _async ( generator: () => Generator<Promise<any>> ) {
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

function* test () {
    const result = yield myGenerator();
}

export default function start () {
    _async( myGenerator );
}