
interface modelConfig {
    model: any;
    reasoning_effort?: "high",
    thinking?: {"type": "enabled"},
}

export class Model {
    model:any;
    constructor(config: modelConfig) {
        this.model = config.model;
    }

    invoke(){}

    stream(){}
}