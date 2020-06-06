export enum ELang {
    JS = 'js',
    TS = 'ts'
}

export type EPathType = Record<ELang, string>
export const EPath: EPathType = {
    [ELang.JS]: 'pages',
    [ELang.TS]: 'miniprogram/pages'
};