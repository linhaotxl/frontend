import { p1, p2, p3, p4 } from './test';

export function* myGenerator (): Generator<Promise<number>> {
    yield p1();
    yield p2();
    yield p3();
    return 0;
}

function _async ( generator: () => Generator<any, any, any> ) {
    const gen = generator();

    gen.next().value.then(( value1: number ) => {
        console.log( 'first value -> ', value1 );
        gen.next().value.then(( value2: number ) => {
            console.log( 'second value -> ', value2 );
            gen.next().value.then(( value3: number ) => {
                console.log( 'third value -> ', value3 );
                console.log( 'return value -> ', gen.next().value );
            });
        });
    });
}

export default function start () {
    _async( myGenerator );
}