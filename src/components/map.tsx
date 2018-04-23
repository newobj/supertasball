import {
  Joint,
  World,
  Vec2,
  DetailedFixtureDef,
  Box,
  Body,
  RevoluteJointOpts,
  T_Vec2,
  Circle,
  ShapeDef,
  FixtureDef,
  Chain,
  Polygon,
  RevoluteJoint,
  BodyType,
  Tags,
} from "planck-js";
const tinycolor = require("tinycolor2");
import { parseSVG, makeAbsolute } from "svg-path-parser";

const gravityY = 150;
const bigAngle = 20;
const lowAngle = 25;

export interface Map {
  leftJoints: Joint[];
  rightJoints: Joint[];
  world: World;
}

export function loadMap(xmlString: string): Map {
  const m: Map = {
    leftJoints: [],
    rightJoints: [],
    world: new World(Vec2(0, gravityY)),
  };

  const fixed = m.world.createBody();
  fixed.createFixture(Box(0, 0), 0.0);

  const doc = new DOMParser().parseFromString(xmlString, "text/xml");

  {
    const paths = doc.querySelectorAll("path");
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const tags = parseTags(path);
      let filterGroupIndex = -1;

      const points = parseSVG(path.attributes["d"].nodeValue);
      makeAbsolute(points);

      let offsetX = 0;
      let offsetY = 0;

      let isStatic = true;
      if (tags.type == "flipper") {
        isStatic = false;
      }

      let jd: RevoluteJointOpts;
      let jointList: Joint[];
      let body: Body;
      let pos = Vec2(0, 0);

      if (tags.type == "flipper") {
        console.log("flipper points = ", points);
        let left = tags.side === "left";
        let right = !left;

        let totalX = 0.0;
        let totalY = 0.0;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of points) {
          if (p.x < minX) {
            minX = p.x;
          }
          if (p.x > maxX) {
            maxX = p.x;
          }
          if (p.y < minY) {
            minY = p.y;
          }
          if (p.y > maxY) {
            maxY = p.y;
          }
          totalX += p.x;
          totalY += p.y;
        }

        totalX /= points.length;
        totalY /= points.length;
        pos.x = totalX;
        pos.y = totalY;

        let width = maxX - minX;
        let height = maxY - minY;
        if (left) {
          pos.x -= width * 0.3169;
        } else {
          pos.x += width * 0.3169;
        }

        offsetX = -pos.x;
        offsetY = -pos.y;
        body = m.world.createBody({
          position: pos,
          type: "dynamic",
          bullet: true,
        });

        jd = {
          enableMotor: true,
          maxMotorTorque: 2000000.0,
          enableLimit: true,
          motorSpeed: 0.0,
        };
        let dir: T_Vec2;
        if (tags.side === "left") {
          jd.lowerAngle = toRadians(-bigAngle);
          jd.upperAngle = toRadians(lowAngle);
          jointList = m.leftJoints;
        } else if (tags.side === "right") {
          jd.lowerAngle = toRadians(-lowAngle);
          jd.upperAngle = toRadians(bigAngle);
          jointList = m.rightJoints;
        } else {
          throw new Error(
            `${
              path.id
            } has #flipper but not #left or #right. full tags: ${JSON.stringify(
              tags,
            )}`,
          );
        }
      } else {
        body = m.world.createBody();
      }
      body.tags = tags;
      parseStyle(path, body);

      const vecs: T_Vec2[] = [];
      for (const p of points) {
        vecs.push(Vec2(p.x + offsetX, p.y + offsetY));
      }

      const shapeDef: ShapeDef = {
        density: isStatic ? 0.0 : 0.1,
        filterGroupIndex,
      };
      let fixtureDef: FixtureDef;
      if (isStatic) {
        fixtureDef = Chain(vecs, false);
      } else {
        fixtureDef = Polygon(vecs);
      }
      body.createFixture(fixtureDef, shapeDef);

      if (jd) {
        const joint = RevoluteJoint(jd, fixed, body, pos);
        m.world.createJoint(joint);
        jointList.push(joint);
      }
    }
  }
  {
    const ellipses = doc.querySelectorAll("ellipse, circle");
    for (let i = 0; i < ellipses.length; i++) {
      const ellipse = ellipses[i] as SVGElement;
      const tags = parseTags(ellipse);

      const position = Vec2(
        +ellipse.attributes["cx"].nodeValue,
        +ellipse.attributes["cy"].nodeValue,
      );
      const radius = +(ellipse.attributes["r"] || ellipse.attributes["rx"])
        .nodeValue;
      let density = 0.02;
      let type: BodyType = "dynamic";
      let bullet = true;
      let isSensor = false;
      let restitution: number = null;
      let filterGroupIndex: number = null;

      if (tags.type === "collect") {
        type = "static";
        density = 0.0;
        bullet = false;
        isSensor = true;
      } else if (tags.type === "bumper") {
        type = "static";
        density = 0.0;
        restitution = 1;
        filterGroupIndex = -1;
      }

      const body = m.world.createBody({
        position,
        type,
        bullet,
      });
      body.tags = tags;
      parseStyle(ellipse, body);
      const ddef: DetailedFixtureDef = {
        shape: Circle(radius),
      };
      if (isSensor) {
        ddef.isSensor = true;
      }
      if (restitution !== null) {
        ddef.restitution = restitution;
      }
      body.createFixture(ddef, {
        density: 0.02,
        filterGroupIndex,
      });
    }
  }

  m.world.on("begin-contact", contact => {
    let bodyA = contact.getFixtureA().getBody();
    let bodyB = contact.getFixtureB().getBody();

    if (bodyB.tags && bodyB.tags.type === "ball") {
      [bodyA, bodyB] = [bodyB, bodyA];
    }

    if (bodyB.tags && bodyB.tags.type === "collect") {
      if (!bodyB.fill) {
        bodyB.fill = true;
        bodyB.fillColor = bodyB.strokeColor;
        bodyB.dirty = true;
      }
    }
  });

  return m;
}

export function toRadians(degrees: number): number {
  return degrees * Math.PI / 180.0;
}

// tag key-value regular expression
const tagKvRe = /^(.*)=(.*)$/;

export function parseTags(el: SVGElement): Tags {
  const tags: Tags = {
    type: "unknown",
  };

  const desc = el.querySelector("desc");
  if (desc) {
    let tokens = desc.textContent.split("\n");
    for (const tok of tokens) {
      if (tok.startsWith("#")) {
        tags.type = tok.replace(/^#/, "");
      } else {
        const matches = tagKvRe.exec(tok);
        if (matches) {
          tags[matches[1]] = matches[2];
        } else {
          tags[tok] = "true";
        }
      }
    }
  }
  return tags;
}

export function parseStyle(el: SVGElement, body: Body) {
  if (el.style.fill != "none") {
    body.fill = true;
    body.fillColor = toPixiColor(el.style.fill);
  }

  if (el.style.stroke != "none") {
    body.stroke = true;
    body.strokeColor = toPixiColor(el.style.stroke);
  }
}

function toPixiColor(input: string): number {
  return parseInt(tinycolor(input).toHex(), 16);
}
