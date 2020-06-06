import chalk from 'chalk';

export const log = ( ...args: any[] ) => {
    console.log(chalk( ...args ));
}

export const logTimeStart = ( text: string ) => {
    const now = Date.now();
    log( text );
    return now;
}

export const logTimeEnd = ( lastNow: number, text: string ) => {
    const period = Date.now() - lastNow;
    const periodSecond = (period / 1000).toFixed( 2 );
    log( `${ text } ${ periodSecond }s` );
}