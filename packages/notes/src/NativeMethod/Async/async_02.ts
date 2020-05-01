import { p1, p2, p3, p4 } from './test';

function* myGenerator () {
    console.log( 'first value -> '  + (yield p1()) );
    console.log( 'second value -> ' + (yield p2()) );
    console.log( 'third value -> '  + (yield p3()) );
    return 0;
}

function _async ( generator: () => Generator ) {
    const gen = generator();

    gen.next().value.then(( value1: number ) => {
        gen.next( value1 ).value.then(( value2: number ) => {
            gen.next( value2 ).value.then(( value3: number ) => {
                console.log( 'return value -> ' + gen.next( value3 ).value );
            });
        });
    });
}

export default function start () {
    _async( myGenerator );
}