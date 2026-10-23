import Openai from "openai";

export interface BaseProvider {
    readonly name: string;
    readonly provider: Openai;
}