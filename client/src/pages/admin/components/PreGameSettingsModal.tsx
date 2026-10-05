import { useState } from 'react';
import { IntegerInput } from '@/components/Input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { AppConfig, GameSettings } from '../../../types';

interface Props {
  config: AppConfig;
  onConfirm: (settings: GameSettings) => void;
  onCancel: () => void;
}

export function PreGameSettingsModal({ config, onConfirm, onCancel }: Props) {
  const [baseScore, setBaseScore] = useState(config.defaultBaseScore);
  const [streakEnabled, setStreakEnabled] = useState(config.streakBonusEnabled);
  const [streakBase, setStreakBase] = useState(config.streakBonusBase);
  const [passEnabled, setPassEnabled] = useState(false);
  const [fiftyFiftyEnabled, setFiftyFiftyEnabled] = useState(false);

  const defaultSettings: GameSettings = {
    baseScore: config.defaultBaseScore,
    streakBonusEnabled: config.streakBonusEnabled,
    streakBonusBase: config.streakBonusBase,
    jokersEnabled: { pass: false, fiftyFifty: false },
  };

  const currentSettings: GameSettings = {
    baseScore,
    streakBonusEnabled: streakEnabled,
    streakBonusBase: streakBase,
    jokersEnabled: { pass: passEnabled, fiftyFifty: fiftyFiftyEnabled },
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6">
      <Card className="z-[201] max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <CardContent className="p-6">
          <h2 className="mb-1">Cài đặt phiên chơi</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Các cài đặt này chỉ áp dụng cho phiên chơi này và không thay đổi mặc định hệ thống.
          </p>

          <div className="flex flex-col gap-5">
            <IntegerInput
              id="pass-joker-score"
              label="Điểm khi dùng quyền bỏ qua"
              min={0}
              value={baseScore}
              onValueChange={setBaseScore}
              hint="Điểm cộng cho mỗi người chơi khi dùng quyền bỏ qua"
            />

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="streak-enabled"
                  checked={streakEnabled}
                  onCheckedChange={(v) => setStreakEnabled(v === true)}
                />
                <Label htmlFor="streak-enabled" className="font-semibold">
                  Bật thưởng chuỗi trả lời đúng
                </Label>
              </div>
              {streakEnabled && (
                <div className="pl-7">
                  <IntegerInput
                    id="streak-base-score"
                    label="Điểm mỗi cấp chuỗi trên mức tối thiểu"
                    min={0}
                    value={streakBase}
                    onValueChange={setStreakBase}
                    noMargin
                  />
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="mb-1 font-semibold">Quyền trợ giúp</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Kích hoạt quyền trợ giúp từ bảng điều khiển trong khi chơi. Mỗi quyền chỉ dùng một
                lần trong một phiên.
              </p>
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="pass-joker"
                    className="mt-0.5"
                    checked={passEnabled}
                    onCheckedChange={(v) => setPassEnabled(v === true)}
                  />
                  <div>
                    <Label htmlFor="pass-joker" className="font-semibold">
                      Bỏ qua
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Cho phép bỏ qua câu hiện tại và nhận điểm cơ bản một lần
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="fifty-fifty-joker"
                    className="mt-0.5"
                    checked={fiftyFiftyEnabled}
                    onCheckedChange={(v) => setFiftyFiftyEnabled(v === true)}
                  />
                  <div>
                    <Label htmlFor="fifty-fifty-joker" className="font-semibold">
                      50/50
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Loại hai đáp án sai một lần (chỉ áp dụng câu một đáp án)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
              Hủy
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => onConfirm(defaultSettings)}
            >
              Dùng mặc định
            </Button>
            <Button
              type="button"
              variant="success"
              className="flex-1"
              onClick={() => onConfirm(currentSettings)}
            >
              Bắt đầu →
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
