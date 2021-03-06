var express = require('express');
var router = express.Router();
var url = require('url');
var request = require('request');
var https = require('https');
var superagent = require('superagent');
require('superagent-charset')(superagent)
// extend with Request#proxy()
require('superagent-proxy')(superagent);
var cheerio = require('cheerio');
var HttpsProxyAgent = require('https-proxy-agent');
var config = require('../config');
var models = require('../models');

var _ = require('underscore');
var async = require('async');
var moment = require('moment');
var fs = require('fs');
var path = require('path');
var util = require('../util');
var rimraf = require('rimraf');

var iconv = require('iconv-lite');

var see_number = 0;

const download = require('image-downloader')

var swig = require('swig');

//access options requset


/* GET home page. */

router.get('/', function (req, res, next) {

    const search = new models.Search();
    search.keyword = req.query.keyword;

    if (_.isEmpty(search.keyword)) {
        // return returnValue(res, -3);
        return getFinishCount(res, search.keyword)
    }

    search.save(function (err, doc) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            //判重
            if (err.code === 11000) {
                return getFinishCount(res, search.keyword)
            }

            console.log(err);
            return returnValue(res, -2);
        }

        return getFinishCount(res, search.keyword)

    });


});


function getFinishCount(res, keyword) {
    //获取条数
    models.Search.count({ finish: true },
        function (err, count) {
            if (err) {
                console.log(err);
                return returnValue(res, -2);
            }

            //检查是否finish
            models.Search.findOne({ keyword: keyword }).exec(async function (err, doc) {
                if (err) {
                    return returnValue(res, -2);
                }


                return res.render('index', {
                    title: '主题阅读',
                    keyword: keyword,
                    archived_number: count,
                    isFinish: doc && doc.finish ? 1 : 0
                });

            });


        }
    );
}


router.get('/search/search', function (req, res, next) {

    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const size = parseInt(req.query.size) >= 0 ? parseInt(req.query.size) : 1; // 0为获取全部

    //container search
    const search = req.query.search;
    //container order
    const sort = req.query.sort;
    const sort_order = parseInt(req.query.sort_order) > 0 ? 1 : -1;

    //search default
    const condition = { finish: true };
    if (!_.isEmpty(search)) {
        condition.keyword = { $regex: new RegExp(search, "i") };
    }

    //sort default
    let sort_condition = { createdAt: -1 };
    if (!_.isEmpty(sort)) {
        sort_condition = Object.assign({ [sort]: sort_order }, sort_condition);
    }

    async.parallel({
        list: function (callback) {
            models.Search.aggregate(
                [
                    { "$match": condition },
                    { "$sort": sort_condition },
                    { "$skip": (page - 1) * size },
                    size !== 0 ? { "$limit": size } : { "$limit": config.no_page_max_get },
                ],
                function (err, docs) {
                    if (err) {
                        console.log(err);
                        return returnValue(res, -2);
                    }

                    return callback(null, docs);


                }
            );
        },
        total: function (callback) {
            models.Search.aggregate(
                [
                    { "$match": condition },
                ],
                function (err, docs) {
                    if (err) {
                        console.log(err);
                        return returnValue(res, -2);
                    }

                    return callback(null, _.size(docs));

                }
            );
        }
    }, function (err, results) {
        if (err) {
            console.log(err);
            return returnValue(res, -2);
        }
        return returnValue(res, 1, null, results);
    });


});

router.post('/search/finish', function (req, res, next) {

    let search = {};
    search.keyword = req.query.keyword;
    search.type = parseInt(req.body.type) > 0 ? true : false;

    if (_.isEmpty(search.keyword)) {
        return returnValue(res, -3);
    }

    models.Search.findOneAndUpdate({ keyword: search.keyword }, { '$set': { finish: search.type } }).exec(function (err, re) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            // console.log(err);
            return returnValue(res, -2);
        }

        //id是否存在
        if (!re) {
            return returnValue(res, -6);
        } else {
            return returnValue(res, 1, null, search);
        }

    });


});

router.get('/search/archived', function (req, res, next) {

    models.Search.find({ finish: true }).sort({ 'updatedAt': -1 }).exec(function (err, docs) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            console.log(err);
            return returnValue(res, -2);
        }


        for (let i = 0; i < docs.length; ++i) {
            // console.log(moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss'));
            docs[i]._doc.updatedAt = moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss');
        }

        return res.render('archived', {
            title: '主题阅读 - archived',
            data: docs,
        });

    });


});

var cookie_header = '';

let fetchWebPage = function (origin_url, number, res) {
    return new Promise(function (resolve, reject) {

        // origin_url = "https://twitter.com/search?q=%E7%94%9F%E9%A7%92%E3%81%A1%E3%82%83%E3%82%93&src=tren&data_id=tweet%3A958451474027003904"
        // origin_url = "https://javtag.com/cn/movie/59uo"

        let origin_url_obj = url.parse(origin_url);

        var options = {};
        options.protocol = origin_url_obj.protocol
        options.host = origin_url_obj.host
        options.method = 'GET'
        options.path = origin_url_obj.path
        options.headers = {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.139 Safari/537.36",
            'accept': "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            'accept-encoding': 'gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'upgrade-insecure-requests': "1",
            'cookie': "__cfduid=dc097927f9be6bd753632e265d7eb792c1526832955; _ga=GA1.2.1202521015.1526832967; _gid=GA1.2.760436584.1530200221; AD_javu_j_P_728x90=4; AD_clic_j_POPUNDER=2; AD_adst_j_POPUNDER=2; AD_enterTime=1530357417; AD_exoc_j_M_728x90=0; AD_juic_j_M_728x90=1; AD_wav_j_P_728x90=14; AD_exoc_j_POPUNDER=2; AD_exoc_j_L_728x90=2; _gat=1; AD_juic_j_L_728x90=3",
        }

        // if (cookie_header) {
        //     cookie_header = cookie_header.split(";")[0];
        //     let now = ("" + new Date().getTime() / 1000).split(".")[0];
        //     cookie_header += "; AD_enterTime=" + now;
        //     cookie_header += "; AD_exoc_j_M_728x90=0; AD_juic_j_M_728x90=0; AD_juic_j_M_300x100=1; AD_juic_j_M_300x250=1; AD_wav_j_P_728x90=1; AD_clic_j_POPUNDER=1; _ga=GA1.2.1202521015." + now + "; _gid=GA1.2.622831459." + now;
        //     console.log("cookie has 22222:" + cookie_header);
        //     options.headers.cookie = cookie_header;
        // }

        console.log(options.protocol + options.host + options.path)

        // var proxy = 'http://127.0.0.1:1087'; // 设置代理
        // var agent = new HttpsProxyAgent(proxy);
        // options.agent = agent;

        https.get(origin_url, function (sres) {

            console.log('请求头：', sres.headers);
            if (sres.headers["set-cookie"]) {
                console.log("set-cookie has 1111111:" + sres.headers["set-cookie"][0]);
                cookie_header = sres.headers["set-cookie"][0];
            }

            var chunks = [];
            sres.on('data', function (chunk) {
                chunks.push(chunk);
                // console.log("receipt data " + chunk);
            });
            sres.on('end', function () {

                var html = iconv.decode(Buffer.concat(chunks), 'utf8');

                // return res.send(html)

                var $ = cheerio.load(html, { decodeEntities: false });


                console.log("fetchWebPage success")
                console.log($("title").text())

                //global
                let SkipTip = "";

                //title
                let title_arr = $("h3").text().split(" ");
                let title = "";
                for (let i = 1; i < title_arr.length; ++i) {
                    title += title_arr[i] + " ";
                }
                // console.log("title:" + title);

                //cover
                let cover = $(".screencap").children("a").attr("href");
                // console.log("cover:" + cover);

                let actor = []
                $("#avatar-waterfall").children("a").each(function (i, element) {
                    let a = {}
                    a.link = $(this).attr("href").trim();
                    a.name = $(this).find("span").text().trim();
                    a.icon = $(this).find("img").attr("src").trim();
                    actor.push(a);
                });

                //info
                let info = $(".info");

                let mark = info.children().first().children().last().text().trim();
                // console.log("mark:" + mark);

                info.children().eq(1).find(".header").remove();
                let time = info.children().eq(1).text().trim();
                // console.log("time:" + time);

                let label = [];
                info.children().last().children().each(function (i, element) {
                    label.push($(this).find("a").text().trim());
                });
                // console.log("label:" + label.join(" "));
                //判断是否建议跳过
                for (let l of label) {
                    if (_.indexOf(config.label_skip, l) >= 0) {
                        SkipTip = "可跳过";
                    }
                }

                //image
                let sample = $("#sample-waterfall");
                let image = [];
                sample.children().each(function (i, element) {
                    image.push($(this).attr("href"));
                });
                // console.log("image:" + image.join("\r\n"));

                //check isLike or isPity
                models.Avmoo.findOne({ "mark": mark }).exec(function (err, re) {

                    if (err) {
                        return reject();
                    }

                    models.Avmoo.count({ "pity": true }).exec(function (err, pity_count) {

                        if (err) {
                            return reject();
                        }

                        models.Avmoo.count({ "like": true }).exec(function (err, like_count) {

                            if (err) {
                                return reject();
                            }

                            let isLikeOrIsPity = "";
                            if (re) {
                                if (re.like) {
                                    isLikeOrIsPity = "like"
                                } else if (re.pity) {
                                    isLikeOrIsPity = "pity"
                                }
                            }

                            resolve({

                                origin_url: origin_url,

                                title: 'avmoo',
                                title_2: title,
                                number: number,
                                cover: cover,
                                actor: actor,
                                mark: mark,
                                time: time,
                                label: label.join(" "),
                                image: image,

                                isLikeOrIsPity: isLikeOrIsPity,
                                like_count: like_count,
                                pity_count: pity_count,

                                SkipTip: SkipTip,
                            })

                        });

                    });

                });

            });
        });

        // var proxy = 'http://112.64.38.148:8118';
        //


        //
        // var proxy = 'http://127.0.0.1:1086'; // 设置代理
        //
        // // origin_url = "www.hao123.com"
        // // origin_url = "https://javtag.com/cn/movie/5r2j"
        // console.log(origin_url);
        //
        //
        // superagent.get(origin_url)
        // // .buffer(true)
        // // .set("X-Forwarded-For","212.152.244.186")
        // // .set("CLIENT_IP","212.152.244.186")
        // // .set("X-Real-IP","212.152.244.186")
        // // .set("remoteAddress","212.152.244.185")
        // //     .proxy(proxy)
        //     .charset("utf8")
        //     // .set("user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) CriOS/56.0.2924.75 Mobile/14E5239e Safari/602.1")
        //     .set('accept', "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8")
        //     .set('accept-encoding', 'gzip, deflate, br')
        //     .set('Accept-Language', 'zh-CN,zh;q=0.9')
        //     .set('cache-control', 'no-cache')
        //     .set('cookie', '__cfduid=df3a26cb5c172cd01478fd54eda0f21721516540789; _ga=GA1.2.1034700224.1516540793; _gid=GA1.2.565623816.1517329090; AD_enterTime=1517329098; AD_exoc_j_M_728x90=0; AD_juic_j_M_728x90=0; AD_exoc_j_M_300x100=1; AD_juic_j_M_300x250=1; AD_wav_j_P_728x90=1; AD_clic_j_POPUNDER=1')
        //     .set('pragma', 'no-cache')
        //     .set('upgrade-insecure-requests', "1")
        //     .set('Connection', "Keep-Alive")
        //     // .set('Content-Encoding', "gzip")
        //
        //     // .set(':authority', 'javhip.com')
        //     // .set(':method', 'GET')
        //     // .set(':scheme', 'https')
        //     //         '_xsrf':xsrf,
        //     .end(function (err, html) {
        //
        //
        //         return res.send(html);
        //
        //         if (err || !html.text) {
        //
        //             console.log("fetchWebPage fail :" + err.status)
        //             // console.log(  err)
        //
        //             return resolve({
        //                 number: number,
        //             })
        //
        //         }
        //
        //         if (!html) {
        //             return resolve({
        //                 number: number,
        //             })
        //         }
        //
        //         //转码
        //         // let $ = cheerio.load(html.text);
        //
        //         // let buf = iconv.encode(html.text, 'utf8');
        //         // let t = iconv.decode( html.text, 'utf8')
        //
        //         let $ = cheerio.load(html.text);
        //         // let $ = cheerio.load(html.text,{decodeEntities: false});
        //
        //
        //     });
    })
};


var downloadImage = function (uri, dest, callback) {
    request.head(uri, function (err, res, body) {
        // console.log('content-type:', res.headers['content-type']);
        // console.log('content-length:', res.headers['content-length']);

        request(uri).pipe(fs.createWriteStream(dest)).on('close', callback);
    });
};


router.get('/hide/avmoo/loading', async function (req, res, next) {

    let number = req.query.number;
    let size = parseInt(req.query.size) > 0 ? parseInt(req.query.size) : 1;
    let all = req.query.all || 0;

    if (_.isEmpty(number)) {
        return returnValue(res, -3);
    }

    //number++
    let end = parseInt(number, 36);
    end = (end + size).toString(36);

    // return res.render('avmoo_loading', {
    //     title: 'avmoo - loading',
    //     end: end,
    //     finish: 3,
    //     size: 10,
    //     rate: 3 / 10 * 100,
    // });

    const bulk = models.AvmooLoading.collection.initializeUnorderedBulkOp();

    let obj_array = [];
    for (let i = 0; i < size; i++) {
        let obj = {};
        obj.number = number;

        let origin_url = config.avmoo_origin_url + '/movie/' + number;
        let result = null;
        try {
            result = await fetchWebPage(origin_url, number);
            if (!result) {
                return returnValue(res, -1);
            }
        } catch (err) {
            return returnValue(res, -1);
        }
        obj.result = result;

        obj_array.push(obj);

        //number++
        number = parseInt(number, 36);
        number = (number + 1).toString(36);

    }


    let flag = 1;
    //to each number
    async.eachLimit(obj_array, 10, function (obj, callback_2) {

        if (all == 1) {

            //图片存本地
            async.parallel([
                function (call) {

                    if (obj.result.cover) {

                        // //cover
                        // const options = {
                        //     url: obj.result.cover,
                        //     dest: config.loading_image_save_location,
                        // }

                        // console.log("save cover start"  );


                        let dest = config.loading_image_save_location + "/" + _.last(obj.result.cover.split("/"));

                        downloadImage(obj.result.cover, dest, function (err) {
                            if (err) {
                                console.log("save cover fail " + obj.result.cover + " : " + dest);
                                return call(err);
                            }
                            console.log("save cover success " + obj.result.cover + " : " + dest);
                            obj.result.cover = "/" + dest;
                            // console.log("save cover end"  );
                            return call();
                        });


                        // download.image(options)
                        //     .then(({filename, image}) => {
                        //         obj.result.cover = "/" + filename;
                        //         // console.log("save cover end"  );
                        //         return call();
                        //     }).catch((err) => {
                        //     console.log("save cover fail " + options.url);
                        //     return call(err);
                        // })

                    } else {
                        return call();
                    }
                },
                function (call) {

                    let image_array = [];
                    //image
                    async.eachLimit(obj.result.image, 10, function (o, callback) {

                        if (o) {

                            // const options = {
                            //     url: o,
                            //     dest: config.loading_image_save_location,
                            // }
                            //
                            // // console.log("save image"  );
                            //
                            // download.image(options)
                            //     .then(({filename, image}) => {
                            //         image_array.push("/" + filename);
                            //         // console.log("save cover end"  );
                            //         return callback();
                            //     }).catch((err) => {
                            //     console.log("save image fail " + o);
                            //     return callback(err);
                            // })

                            let dest = config.loading_image_save_location + "/" + _.last(o.split("/"));

                            downloadImage(o, dest, function (err) {
                                if (err) {
                                    return callback(err);
                                    console.log("save image fail " + o + " : " + dest);
                                }
                                image_array.push("/" + dest);
                                console.log("save image success " + o + " : " + dest);
                                return callback();

                            });

                        } else {
                            console.log("no image  " + o);
                            return callback();
                        }

                    }, function (err) {
                        if (err) {
                            console.log("  fail  1   !!!");
                            return call(err);
                        }
                        console.log("  success  1   !!!");
                        if (image_array.length > 0) {
                            image_array = _.sortBy(image_array, function (name) {
                                return parseInt(name.split("-")[1]);
                            });
                        }
                        obj.result.image = image_array;
                        return call();
                    });
                }
            ],
                function (err) {
                    if (err) {
                        console.log("  fail    2     !!!");
                        return callback_2(err);
                    }

                    //存数据库
                    bulk.find({ number: obj.number }).upsert().update({ $set: { content: obj.result } });

                    console.log("  success    2     !!!" + obj.number + " 第" + (flag++) + "个");

                    return callback_2();
                });

        } else {
            //存数据库
            bulk.find({ number: obj.number }).upsert().update({ $set: { content: obj.result } });

            console.log("  success    2     !!!" + obj.number + " 第" + (flag++) + "个");

            return callback_2();
        }

    },
        function (err) {
            if (err) {
                console.log("  fail    3     !!!");
                console.log(err);
                return returnValue(res, -1);
            }

            console.log("bulk.execute start")

            //存入数据库
            bulk.execute(function (err, re) {
                if (err) {
                    return res.status(500).send(err);
                }

                console.log("bulk.execute end" + "  " + end)


                // return res.status(500).send(re);

                return res.render('avmoo_loading', {
                    title: 'avmoo - loading',
                    end: end,
                    finish: (re.nUpserted + re.nMatched),
                    size: size,
                    rate: (re.nUpserted + re.nMatched) / size * 100,
                });
            });

        }
    );


});

function downloadIMG(url) {

    return new Promise(function (resolve, reject) {

        const options = {
            url: url,
            dest: config.loading_image_save_location,
        }

        download.image(options)
            .then(({ filename, image }) => {
                resolve(filename)
            }).catch((err) => {
                reject(err)
            })

    });
}

function saveAvmooLoading(bulk, result) {

    return new Promise(function (resolve, reject) {
        const avmooLoading = new models.AvmooLoading();
        avmooLoading.content = result;
        bulk.insert(avmooLoading);
        avmooLoading.save(function (err, doc) {
            if (err) {
                reject()
            }
            resolve()
        });
    });

}

router.get('/hide/avmoo/clearLoading', function (req, res, next) {

    //移除图片文件

    rimraf(path.join(__dirname, "..", config.loading_image_save_location), function (err) {
        if (err) {
            console.log(err);
            return returnValue(res, -1);
        }

        //重建文件夹
        util.mkdirsSync(config.loading_image_save_location);

        models.AvmooLoading.remove({}).exec(function (err, re) {
            if (err) {

                //字段格式
                if (err.name == "CastError") {
                    return returnValue(res, -4);
                }

                console.log(err);
                return returnValue(res, -2);
            }

            if (re.result.ok) {
                return returnValue(res, 1, null, re.result.n);
            } else {
                return returnValue(res, -6);
            }

        });

    });


});

router.get('/hide/avmoo', function (req, res, next) {


    const number = req.query.number;

    if (_.isEmpty(number)) {
        return returnValue(res, -6);
    }

    //检查数据库有没有
    models.AvmooLoading.findOne({ number: number }).exec(async function (err, doc) {
        if (err) {
            return returnValue(res, -2);
        }


        if (doc) {

            console.log("load offline" + "doc : " + doc);

            return res.render('avmoo', Object.assign({
                cache: 1,
                cur_number: number,
                see_number: (++see_number)
            }, doc.content));

            // return res.status(500).send(doc.content);
        } else {

            let origin_url = config.avmoo_origin_url + '/movie/' + number;

            console.log("load online");

            try {
                let result = await
                    fetchWebPage(origin_url, number, res);

                return res.render('avmoo', Object.assign({ cur_number: number, see_number: (++see_number) }, result));

            } catch (err) {

                console.log(err);
                return returnValue(res, -2);
            }

        }

    });


});


router.post('/hide/avmoo/add', function (req, res, next) {

    const avmoo = new models.Avmoo();
    avmoo.number = req.body.number;
    avmoo.title = req.body.title;
    avmoo.mark = req.body.mark;
    avmoo.cover = req.body.cover;
    avmoo.time = req.body.time;

    avmoo.like = req.body.like;
    avmoo.pity = req.body.pity;

    //actor
    let temp_actor = [];
    if (req.body.actor) {
        // avmoo.actor = JSON.parse(req.body.actor);
        let t = req.body.actor.split(" ");
        for (let i = 0; i < _.size(t); i++) {
            let obj = {};
            obj.name = t[i];
            temp_actor.push(obj);
        }
    }
    avmoo.actor = temp_actor;


    //label
    let temp_label = [];
    if (req.body.label) {
        // avmoo.label = JSON.parse(req.body.label);
        let t = req.body.label.split(" ");
        for (let i = 0; i < _.size(t); i++) {
            let obj = {};
            obj.name = t[i];
            temp_label.push(obj);
        }
    }
    avmoo.label = temp_label;


    avmoo.save(function (err, avmoo) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            //判重
            if (err.code === 11000) {
                return returnValue(res, -5);
            }

            console.log(err);
            return returnValue(res, -2);
        }
        return returnValue(res, 1, null, avmoo);
    });


});


router.post('/hide/avmoo/del', function (req, res, next) {

    let ids = req.body.mark;

    if (_.isEmpty(ids)) {
        return returnValue(res, -3);
    }

    if (ids.indexOf(",") >= 0) {
        ids = ids.split(",");
    } else {
        let t = [];
        t.push(ids);
        ids = t;
    }

    if (ids.length <= 0) {
        return returnValue(res, -3);
    }

    models.Avmoo.remove({ "mark": { $in: ids } }).exec(function (err, re) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            console.log(err);
            return returnValue(res, -2);
        }

        if (re.result.ok && re.result.n > 0) {
            return returnValue(res, 1, null, re.result.n);
        } else {
            return returnValue(res, -6);
        }

    });

});


router.get('/hide/avmoo/like_archived', function (req, res, next) {

    models.Avmoo.find({ like: true }).sort({ 'updatedAt': -1 }).exec(function (err, docs) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            console.log(err);
            return returnValue(res, -2);
        }

        for (let i = 0; i < docs.length; ++i) {
            // console.log(moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss'));
            docs[i]._doc.updatedAt = moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss');
            if (docs[i].label && docs[i].label.length > 0) {
                let label_s = "";
                for (let j = 0; j < docs[i].label.length; ++j) {
                    label_s += docs[i].label[j].name + " ";
                }
                docs[i]._doc.label = label_s;
            }
            if (docs[i].actor && docs[i].actor.length > 0) {
                let actor_s = "";
                for (let j = 0; j < docs[i].actor.length; ++j) {
                    actor_s += docs[i].actor[j].name + " ";
                }
                docs[i]._doc.actor = actor_s;
            }
        }

        return res.render('avmoo_archived', {
            title: 'avmoo - like archived',
            data: docs,
            data_count: _.size(docs),
        });

    });


});

router.get('/hide/avmoo/pity_archived', function (req, res, next) {

    models.Avmoo.find({ pity: true }).sort({ 'updatedAt': -1 }).exec(function (err, docs) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            console.log(err);
            return returnValue(res, -2);
        }


        for (let i = 0; i < docs.length; ++i) {
            // console.log(moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss'));
            docs[i]._doc.updatedAt = moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss');
            if (docs[i].label && docs[i].label.length > 0) {
                let label_s = "";
                for (let j = 0; j < docs[i].label.length; ++j) {
                    label_s += docs[i].label[j].name + " ";
                }
                docs[i]._doc.label = label_s;
            }
            if (docs[i].actor && docs[i].actor.length > 0) {
                let actor_s = "";
                for (let j = 0; j < docs[i].actor.length; ++j) {
                    actor_s += docs[i].actor[j].name + " ";
                }
                docs[i]._doc.actor = actor_s;
            }
        }

        return res.render('avmoo_archived', {
            title: 'avmoo - pity archived',
            data: docs,
            data_count: _.size(docs),
        });

    });


});

router.get('/hide/avmoo/get', function (req, res, next) {

    models.Avmoo.findOne({ mark:  req.query.mark }).exec(function (err, doc) {
        if (err) { 
            console.log(err); return returnValue(res, -3);
        }
        models.Avmoo.count({ "pity": true }).exec(function (err, pity_count) {

            if (err) {
                console.log(err); return returnValue(res, -3);
            }

            models.Avmoo.count({ "like": true }).exec(function (err, like_count) {

                if (err) {
                    console.log(err); return returnValue(res, -3);
                }

                let isLikeOrIsPity = "";
                if (doc) {
                    if (doc.like) {
                        isLikeOrIsPity = "like"
                    } else if (doc.pity) {
                        isLikeOrIsPity = "pity"
                    }
                }

                return res.json(  {
                    code: 0,
                    data: doc, 
                    like_count, 
                    pity_count ,
                    isLikeOrIsPity
                }); 

            });

        });
       

    });


});

router.get('/hide/avmoo/actor_archived', function (req, res, next) {

    let actor = req.query.actor;

    if (_.isEmpty(actor)) {
        return returnValue(res, -3);
    }

    models.Avmoo.find({ "actor.name": actor }).sort({ 'updatedAt': -1 }).exec(function (err, docs) {
        if (err) {

            //字段格式
            if (err.name == "CastError") {
                return returnValue(res, -4);
            }

            console.log(err);
            return returnValue(res, -2);
        }


        for (let i = 0; i < docs.length; ++i) {
            // console.log(moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss'));
            docs[i]._doc.updatedAt = moment(docs[i].updatedAt).format('YYYY-MM-DD HH:mm:ss');
            if (docs[i].label && docs[i].label.length > 0) {
                let label_s = "";
                for (let j = 0; j < docs[i].label.length; ++j) {
                    label_s += docs[i].label[j].name + " ";
                }
                docs[i]._doc.label = label_s;
            }
            if (docs[i].actor && docs[i].actor.length > 0) {
                let actor_s = "";
                for (let j = 0; j < docs[i].actor.length; ++j) {
                    actor_s += docs[i].actor[j].name + " ";
                }
                docs[i]._doc.actor = actor_s;
            }

        }

        return res.render('avmoo_archived', {
            title: 'avmoo - actor archived',
            data: docs,
            data_count: _.size(docs),
        });

    });


});


var returnValue = function (res, code, message, value) {

    if (!message) {
        if (code == 1) {
            message = "ok"
        } else if (code == -1) {
            message = "server errer"
        } else if (code == -2) {
            message = "database errer"
        } else if (code == -3) {
            message = "params is empty"
        } else if (code == -4) {
            message = "params is invalid"
        } else if (code == -5) {
            message = "data is exist"
        } else if (code == -6) {
            message = "data is not exist"
        }
    }

    if (code == -1 && code == -2) {
        return res.status(500).send({ code: code, message: message, value: value });
    }
    else {
        return res.status(200).send({ code: code, message: message, value: value });
    }

};

module.exports = router;
