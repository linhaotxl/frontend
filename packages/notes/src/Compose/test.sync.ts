export const Middleware1 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware1 start.' );
    const result = next();
    console.log( 'Sync Middleware1 end.', result );
};

export const Middleware2 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware2 start.' );
    const result = next();
    console.log( 'Sync Middleware2 end.', result );
};

export const Middleware3 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware3 start.' );
    const result = next();
    console.log( 'Sync Middleware3 end.', result );
};