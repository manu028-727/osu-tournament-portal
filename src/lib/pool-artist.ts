// The same normalization identifies review warnings in the editor and service.
export const artistKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');
