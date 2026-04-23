-- 1) 创建规则库表
CREATE TABLE IF NOT EXISTS public.rule_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_no text,
  content text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.rule_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rule_library read all authenticated"
ON public.rule_library FOR SELECT TO authenticated USING (true);

CREATE POLICY "rule_library admin manage"
ON public.rule_library FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_rule_library_updated_at
BEFORE UPDATE ON public.rule_library
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) 写入 34 条文本规则
INSERT INTO public.rule_library (rule_no, content) VALUES
($$说明$$, $$本科生创新实践学分的认定范围包括科研成果、知识产权、科研训练、学科竞赛、职业技能证书、创业实践、文体竞赛等$$),
($$规则5$$,  $$类别=论文；级别=SCI/SSCI/CSSCI；身份=第一作者；学分=10$$),
($$规则6$$,  $$类别=论文；级别=SCI/SSCI/CSSCI；身份=其他作者；学分=8$$),
($$规则7$$,  $$类别=论文；级别=EI/CPCI/北大核心；身份=第一作者；学分=8$$),
($$规则8$$,  $$类别=论文；级别=EI/CPCI/北大核心；身份=其他作者；学分=6$$),
($$规则9$$,  $$类别=论文；级别=普刊；身份=第一作者；学分=6$$),
($$规则10$$, $$类别=论文；级别=普刊；身份=其他作者；学分=4$$),
($$规则11$$, $$类别=科研项目；级别=省市政府项目；身份=主持人；学分=10$$),
($$规则12$$, $$类别=科研项目；级别=省市政府项目；身份=参与人；学分=8$$),
($$规则13$$, $$类别=科研项目；级别=市级以上/行业课题；身份=主持人；学分=8$$),
($$规则14$$, $$类别=科研项目；级别=市级以上/行业课题；身份=参与人；学分=6$$),
($$规则15$$, $$类别=科研项目；级别=省级学会；身份=主持人；学分=4$$),
($$规则16$$, $$类别=科研项目；级别=省级学会；身份=参与人；学分=2$$),
($$规则17$$, $$类别=知识产权；身份=第一署名；学分=6$$),
($$规则18$$, $$类别=知识产权；身份=其他成员；学分=4$$),
($$规则19$$, $$类别=大创项目；级别=国家级；身份=主持人；学分=6$$),
($$规则20$$, $$类别=大创项目；级别=国家级；身份=第一参与人；学分=5$$),
($$规则21$$, $$类别=大创项目；级别=国家级；身份=其他参与人；学分=4$$),
($$规则22$$, $$类别=竞赛；级别=国家级一等奖；身份=负责人；学分=10$$),
($$规则23$$, $$类别=竞赛；级别=国家级一等奖；身份=第一参与人；学分=9$$),
($$规则24$$, $$类别=竞赛；级别=国家级一等奖；身份=其他参与人；学分=8$$),
($$规则25$$, $$类别=竞赛；级别=省级一等奖；身份=负责人；学分=8$$),
($$规则26$$, $$类别=竞赛；级别=省级一等奖；身份=第一参与人；学分=7$$),
($$规则27$$, $$类别=竞赛；级别=省级一等奖；身份=其他参与人；学分=6$$),
($$规则28$$, $$类别=英语；级别=六级；学分=6$$),
($$规则29$$, $$类别=英语；级别=四级；学分=4$$),
($$规则30$$, $$类别=计算机/职业证书；级别=高级；学分=6$$),
($$规则31$$, $$类别=计算机/职业证书；级别=中级；学分=4$$),
($$规则32$$, $$类别=计算机/职业证书；级别=初级；学分=2$$),
($$规则33$$, $$类别=其他证书；学分=2$$),
($$规则34$$, $$类别=第二课堂；条件=16学时或1周；学分=1$$);

-- 3) 删除 rules 表中与文本严格对应的「通用模板」
DELETE FROM public.rules WHERE id IN (
  -- 论文 通用模板
  'df638d54-26f5-4ed8-9fa2-3280ddeb29f0', -- 论文-SCI/SSCI/CSSCI-第一作者
  'e5239182-866f-4582-91c7-5249b1236760', -- 论文-SCI/SSCI/CSSCI-其他作者
  'ed005246-ae7a-45aa-afe2-d5cf38aa5511', -- 论文-EI/CPCI/北大核心-第一作者
  '999ba6a8-57e5-4e69-a28a-b9d58dba9e96', -- 论文-EI/CPCI/北大核心-其他作者
  'dd7f2303-3e0c-48fb-b465-7808582046e4', -- 论文-普刊-其他作者
  -- 科研项目 通用模板
  '3ad4fed3-2a18-4d0e-a599-5a4be8e74b0c', -- 科研项目-省市政府-主持人
  '5602ad6d-5fd7-4155-ad5a-9cffd5cf57cd', -- 科研项目-省市政府-参与人
  '7ea79fd9-57e2-4a73-96b3-85ca4f82b707', -- 科研项目-市级以上行业课题-主持人
  'ef2ef2e6-1540-4c86-854b-4a0000cbc66a', -- 科研项目-市级以上行业课题-参与人
  'fa592747-0638-476b-ba18-47545e72e55f', -- 科研项目-省级学会-主持人
  'a8abafd6-a1d6-4ce9-bc71-81f78e73d7db', -- 科研项目-省级学会-参与人
  -- 知识产权 通用模板（无 level）
  '39605abe-7db5-4ea4-a079-2307df99accf', -- 知识产权-第一署名
  'cfcc6807-9465-4a77-97e2-59fb45098b20', -- 知识产权-其他成员
  -- 大创项目 通用模板
  '30fcb0c2-f45a-40ce-b183-b29bd2a6c0bf', -- 大创项目-国家级-主持人
  '035d8fee-a8e3-44ef-9c5c-71106fab9ddb', -- 大创项目-国家级-第一参与人
  'fd4f1649-bcb7-4444-b919-2829edeefbac', -- 大创项目-国家级-其他参与人
  -- 竞赛 通用模板
  'cf77f84e-b86c-47c5-a7c7-10d37584c3f8', -- 竞赛-国家级一等奖-负责人
  '740870e0-4107-4012-9480-8df480997766', -- 竞赛-国家级一等奖-第一参与人
  'ee6eb79b-add4-4047-b1ba-0f379f28d4d1', -- 竞赛-国家级一等奖-其他参与人
  '75dbef44-90e4-4637-b765-61c1d2ecc80e', -- 竞赛-省级一等奖-负责人
  'fc793e77-d049-4ee7-9f1d-5be5917956a6', -- 竞赛-省级一等奖-第一参与人
  '74ce6ea0-b04b-483b-9cab-5ed125afc927', -- 竞赛-省级一等奖-其他参与人
  -- 英语 通用模板
  '19153258-1b19-4522-a7e1-db0918687f75', -- 英语六级
  '8efbbca8-3b3e-41aa-872a-cb1ff29ba0df', -- 英语四级
  -- 计算机/职业证书 通用模板
  '05d3d989-b016-4ed3-9fe2-74730defc0ff', -- 计算机/职业证书-高级
  '0533e52a-2a36-4d5f-8236-cac03d4c12de', -- 计算机/职业证书-中级
  'eae15a60-d20d-45d5-9bb1-ac05f5aba8fb', -- 计算机/职业证书-初级
  -- 其他证书
  'c9fefa13-0580-4dba-843a-2628d9c0a466', -- 其他证书
  -- 第二课堂 通用模板
  'ffdae067-0c51-4ee3-83f8-04b4c53b5ad7'  -- 第二课堂-16学时或1周
);