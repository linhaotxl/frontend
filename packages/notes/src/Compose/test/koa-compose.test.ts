import { compose } from '../koa-compose';
// import assert from 'as'

function wait ( ms: number ) {
    return new Promise( resolve => setTimeout( resolve, ms || 1 ) )
}
  
function isPromise ( x: any ) {
    return x && typeof x.then === 'function'
}

describe( 'Koa Compose', function () {
    it( 'shoudle work', async () => {
        const arr: number[]     = [];
        const stack: Function[] = [];

        stack.push(async ( context: any, next: Function ) => {
            arr.push(1);
            await wait(1);
            await next();
            await wait(1);
            arr.push(6);
        });

        stack.push(async ( context: any, next: Function ) => {
            arr.push(2)
            await wait(1)
            await next()
            await wait(1)
            arr.push(5)
        });

        stack.push(async ( context: any, next: Function ) => {
            arr.push(3)
            await wait(1)
            await next()
            await wait(1)
            arr.push(4)
        });

        await compose( stack )( {} );
        expect( arr ).toEqual( expect.arrayContaining([ 1, 2, 3, 4, 5, 6 ]) )
    });
    
    
});