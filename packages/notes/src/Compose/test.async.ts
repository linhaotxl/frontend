export const delay = ( time: number ) => new Promise( resolve => {
    setTimeout(() => {
        resolve();
    }, time)
});

export const Middleware1 = async ( context: any, next: Function ) => {
    console.log( 'Async Middleware1 start.' );
    const result = await next();
    console.log( 'Async Middleware1 end.', result );
};

export const Middleware2 = async ( context: any, next: Function ) => {
    console.log( 'Async Middleware2 start.' );
    const result = await next();
    console.log( 'Async Middleware2 end.', result );
};

export const Middleware3 = async ( context: any, next: Function ) => {
    console.log( 'Async Middleware3 start.' );
    const result = await next();
    console.log( 'Async Middleware3 end.', result );
    return '33333';
};

export const Middleware4 = async ( context: any, next: Function ) => {
    console.log( 'Async Middleware4 start.' );
    throw new Error( 'Async Middleware4 error.' );
    const result = await next();
    console.log( 'Async Middleware4 end.', result );
    return '444';
};

export const Middleware5 = async ( context: any, next: Function ) => {
    console.log( 'Async Middleware5 start.' );
    console.log( 'delay... start' );
    await delay( 3000 );
    console.log( 'delay... end' );
    const result = await next();
    console.log( 'Async Middleware5 end.', result );
};