import Openai from "openai";

export interface BaseProvider {
    name: string;
    provider: Openai;
}