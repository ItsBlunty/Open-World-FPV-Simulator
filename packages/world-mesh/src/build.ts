// Small helpers that build triangle meshes from boxes and quads: test rooms now, blockout levels later.

export class MeshBuilder {
    readonly positions: number[] = [];
    readonly indices: number[] = [];

    /** Quad a-b-c-d (in order around its edge) as two triangles. */
    quad(a: number[], b: number[], c: number[], d: number[]): this {
        const i = this.positions.length / 3;
        this.positions.push(...a, ...b, ...c, ...d);
        this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
        return this;
    }

    triangle(a: number[], b: number[], c: number[]): this {
        const i = this.positions.length / 3;
        this.positions.push(...a, ...b, ...c);
        this.indices.push(i, i + 1, i + 2);
        return this;
    }

    /** The six faces of the axis-aligned box from min to max. */
    box(min: number[], max: number[]): this {
        const [x0, y0, z0] = min;
        const [x1, y1, z1] = max;
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom
        this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // top
        this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // -z
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
        this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // +x
        return this;
    }
}
